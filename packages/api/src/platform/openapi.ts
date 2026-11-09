import { OpenAPIGenerator, type OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError, ORPCError, type AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { BaseContext } from "../context";
import type { ApiErrorData } from "./errors";
import type { ExposedProcedure } from "./exposure";
import type { OperationReceipt } from "./operations";
import type { ApiPorts } from "./ports";

/** Response header with the id of the operation a write recorded (its receipt). */
export const OPERATION_ID_HEADER = "Louez-Operation-Id";
/** Response header set to `true` when an idempotency key replayed a stored result. */
export const REPLAYED_HEADER = "Louez-Replayed";

/** Where the app mounts the OpenAPI transport. */
export const OPENAPI_PREFIX = "/api/v1";

/**
 * Largest body `/api/v1` reads. The longest inputs are legal texts of
 * 100,000 characters, two in one call, which JSON may escape to six bytes a
 * character.
 */
export const OPENAPI_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Largest body of a procedure that takes a file's bytes
 * (`meta.mcp.inlineFile`): a 5 MB image is 6.7 MB of base64.
 */
export const OPENAPI_INLINE_FILE_MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The routes (`POST /categories/images`) of the procedures that take a
 * file's bytes, which may send a body up to
 * `OPENAPI_INLINE_FILE_MAX_BODY_BYTES`.
 */
export function inlineFileRoutes(procedures: readonly ExposedProcedure[]): ReadonlySet<string> {
  const routes = new Set<string>();
  for (const { procedure, meta } of procedures) {
    const { method, path } = procedure["~orpc"].route;
    if (meta.mcp.inlineFile && method && path) routes.add(`${method} ${path}`);
  }
  return routes;
}

function tooLarge(maxBytes: number): Response {
  const error = new ORPCError<"PAYLOAD_TOO_LARGE", ApiErrorData>("PAYLOAD_TOO_LARGE", {
    message: `The request body is larger than ${maxBytes} bytes. Send a larger image as a public imageUrl.`,
    data: { code: "REQUEST_TOO_LARGE", retryable: false, details: { maxBytes } },
  });
  return Response.json(error.toJSON(), { status: 413 });
}

/**
 * The request with its body read, at most `maxBytes`, streaming: a body past
 * it, declared or sent, gets 413 before anything parses it or checks who
 * sent it.
 */
async function withBoundedBody(request: Request, maxBytes: number): Promise<Request | Response> {
  if (!request.body) return request;
  if (Number(request.headers.get("content-length")) > maxBytes) {
    await request.body.cancel().catch(() => {});
    return tooLarge(maxBytes);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks),
    signal: request.signal,
  });
}

/** What the OpenAPI generator and the reference plugin need to read Zod 4 schemas. */
const openApiGeneratorOptions = {
  schemaConverters: [new ZodToJsonSchemaConverter()],
};

/**
 * The parts of the `/api/v1` document that do not come from the procedures:
 * the API key scheme, the idempotency and confirmation headers, the receipt
 * headers, and the error body every transport sends.
 */
const openApiDocumentOptions = {
  info: {
    title: "Louez API",
    version: "1.0.0",
    description:
      "Every action of the Louez dashboard, for scripts and integrations. Authenticate with an API key from Settings > API.",
  },
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "lz_…",
        description:
          "A Louez API key, sent as `Authorization: Bearer lz_…`. A key works on its store only.",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        description:
          "Makes a write safe to retry. The same key with the same input returns the stored result without running again; with another input it fails with IDEMPOTENCY_KEY_REUSED.",
        schema: { type: "string", minLength: 1, maxLength: 100 },
      },
      LouezConfirmation: {
        name: "Louez-Confirmation",
        in: "header",
        required: false,
        description:
          "The token a CONFIRMATION_REQUIRED error returned. Send the same input again with it to go ahead. Valid ten minutes, once.",
        schema: { type: "string" },
      },
    },
    headers: {
      LouezOperationId: {
        description: "Id of the operation this write recorded.",
        schema: { type: "string" },
      },
      LouezReplayed: {
        description: "`true` when the result was replayed for a repeated idempotency key.",
        schema: { type: "string", enum: ["true"] },
      },
    },
  },
  customErrorResponseBodySchema: () => ({
    type: "object",
    properties: {
      defined: { type: "boolean" },
      code: { type: "string", description: "HTTP-level code, such as FORBIDDEN." },
      status: { type: "number" },
      message: {
        type: "string",
        description: "Plain English, written for a model or a developer.",
      },
      data: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Stable code to branch on, such as PERMISSION_DENIED.",
          },
          retryable: { type: "boolean", description: "Whether the same call can succeed later." },
          i18nKey: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
        required: ["code", "retryable"],
      },
    },
    required: ["defined", "code", "status", "message"],
  }),
} satisfies OpenAPIGeneratorGenerateOptions;

/** The OpenAPI 3.1 document of a router, as `/api/v1/openapi.json` serves it. */
export function generateOpenApiDocument(router: AnyRouter, serverUrl?: string) {
  return new OpenAPIGenerator(openApiGeneratorOptions).generate(router, {
    ...openApiDocumentOptions,
    ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
  });
}

/**
 * The OpenAPI transport over the exposed router (`createExposure(...).router`),
 * never the whole router. With `docs`, it also serves the spec at
 * `/openapi.json` and a Scalar reference at `/docs`; otherwise those paths
 * match nothing. The app turns them on in development only.
 */
export function createOpenApiHandler(
  router: AnyRouter,
  options: { docs: boolean; onError?: (error: unknown) => void },
): OpenAPIHandler<BaseContext> {
  return new OpenAPIHandler<BaseContext>(router, {
    plugins: options.docs
      ? [
          new OpenAPIReferencePlugin<BaseContext>({
            ...openApiGeneratorOptions,
            specPath: "/openapi.json",
            docsPath: "/docs",
            docsTitle: openApiDocumentOptions.info.title,
            // Pinned: oRPC's default loads whatever version jsdelivr serves today.
            docsScriptUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.0",
            specGenerateOptions: openApiDocumentOptions,
          }),
        ]
      : [],
    interceptors: options.onError ? [onError(options.onError)] : [],
  });
}

/**
 * Serves one request with an API key: the transport is `openapi`, and a write
 * answers with its receipt in the `Louez-Operation-Id` header (and
 * `Louez-Replayed: true` when an idempotency key replayed it). Errors keep
 * oRPC's JSON shape, with our `data` (code, retryable, i18nKey, details).
 * Undefined when no procedure matches.
 */
export async function handleOpenApiRequest(
  handler: OpenAPIHandler<BaseContext>,
  incoming: Request,
  options: {
    ports: ApiPorts;
    prefix?: `/${string}`;
    /** Routes that take a file's bytes (`inlineFileRoutes`); every other body stops at 2 MiB. */
    inlineFileRoutes?: ReadonlySet<string>;
  },
): Promise<Response | undefined> {
  const prefix = options.prefix ?? OPENAPI_PREFIX;
  const { pathname } = new URL(incoming.url);
  const route = `${incoming.method} ${pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname}`;
  const bounded = await withBoundedBody(
    incoming,
    options.inlineFileRoutes?.has(route)
      ? OPENAPI_INLINE_FILE_MAX_BODY_BYTES
      : OPENAPI_MAX_BODY_BYTES,
  );
  if (bounded instanceof Response) return bounded;
  const request = bounded;
  const receipt: OperationReceipt = {};
  const { response } = await handler.handle(request, {
    prefix,
    context: { headers: request.headers, transport: "openapi", ports: options.ports, receipt },
  });
  if (!response) return undefined;
  if (receipt.operationId) {
    response.headers.set(OPERATION_ID_HEADER, receipt.operationId);
    if (receipt.replayed) response.headers.set(REPLAYED_HEADER, "true");
  }
  return response;
}

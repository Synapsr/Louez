import { OpenAPIGenerator, type OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError, ORPCError, type AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { BaseContext } from "../context";
import { resolveAccountActor } from "./actor";
import { reportUnexpectedErrors } from "./error-reporting";
import { largeBodyBusy, takeLargeBodyPlace } from "./large-bodies";
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
 * Largest body `/api/v1` reads, unless the procedure takes more
 * (`meta.maxBodyBytes`). The longest inputs of the others are legal texts of
 * 100,000 characters, two in one call, which JSON may escape to six bytes a
 * character.
 */
export const OPENAPI_MAX_BODY_BYTES = 2 * 1024 * 1024;

/** A route whose procedure takes a larger body (`meta.maxBodyBytes`). */
export interface RouteBodyLimit {
  method: string;
  /** The route's path, its `{params}` matching one segment. */
  pattern: RegExp;
  maxBytes: number;
}

/**
 * The routes of the procedures that take a body larger than
 * `OPENAPI_MAX_BODY_BYTES`, with their limit: `POST /categories/images`,
 * `PATCH /products/{id}`… A procedure without a route is
 * `POST /<path with slashes>`.
 */
export function routeBodyLimits(procedures: readonly ExposedProcedure[]): RouteBodyLimit[] {
  const limits: RouteBodyLimit[] = [];
  for (const { path, procedure, meta } of procedures) {
    if (!meta.maxBodyBytes) continue;
    const route = procedure["~orpc"].route;
    const template = route.path ?? `/${path.split(".").join("/")}`;
    const pattern = new RegExp(
      `^${template
        .split(/(\{[^}]+\})/)
        .map((part) =>
          /^\{[^}]+\}$/.test(part) ? "[^/]+" : part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"),
        )
        .join("")}/?$`,
    );
    limits.push({ method: route.method ?? "POST", pattern, maxBytes: meta.maxBodyBytes });
  }
  return limits;
}

const errorResponse = (error: ORPCError<string, unknown>, headers?: HeadersInit) =>
  Response.json(error.toJSON(), { status: error.status, headers });

function tooLarge(maxBytes: number): Response {
  return errorResponse(
    new ORPCError<"PAYLOAD_TOO_LARGE", ApiErrorData>("PAYLOAD_TOO_LARGE", {
      message: `The request body is larger than ${maxBytes} bytes, the most this route takes. Send an image as a public imageUrl rather than its bytes. Split a very large product: create it, then add units in further updates, or fill each unit's details with products_update_unit_details.`,
      data: { code: "REQUEST_TOO_LARGE", retryable: false, details: { maxBytes } },
    }),
  );
}

/**
 * The request with its body read, streaming, at most `maxBytes`: a body past
 * it, declared or sent, gets 413 before anything parses it. Past
 * `OPENAPI_MAX_BODY_BYTES` (declared, or once that much was read), the
 * request must first pass `enterLarge`, which answers a refusal or null.
 */
async function withBoundedBody(
  request: Request,
  maxBytes: number,
  enterLarge: () => Promise<Response | null>,
): Promise<Request | Response> {
  if (!request.body) return request;
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) {
    await request.body.cancel().catch(() => {});
    return tooLarge(maxBytes);
  }
  let entered = false;
  if (declared > OPENAPI_MAX_BODY_BYTES) {
    const refusal = await enterLarge();
    if (refusal) {
      await request.body.cancel().catch(() => {});
      return refusal;
    }
    entered = true;
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
    if (!entered && size > OPENAPI_MAX_BODY_BYTES) {
      const refusal = await enterLarge();
      if (refusal) {
        await reader.cancel().catch(() => {});
        return refusal;
      }
      entered = true;
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
    // An unexpected error reaches error tracking through `ports.reportError`.
    clientInterceptors: [reportUnexpectedErrors],
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
    /** Routes that take a larger body (`routeBodyLimits`); every other body stops at 2 MiB. */
    bodyLimits?: readonly RouteBodyLimit[];
    /**
     * Who calls, checked from the headers before more than 2 MiB is read;
     * it throws the platform's error. The procedure checks again. Default:
     * the API key or access token, as the procedures resolve it.
     */
    authenticate?: (headers: Headers) => Promise<unknown>;
  },
): Promise<Response | undefined> {
  const prefix = options.prefix ?? OPENAPI_PREFIX;
  const { pathname } = new URL(incoming.url);
  const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const larger = options.bodyLimits?.find(
    (limit) => limit.method === incoming.method && limit.pattern.test(path),
  );
  const authenticate =
    options.authenticate ??
    ((headers: Headers) => resolveAccountActor({ transport: "openapi", headers }));

  // Past 2 MiB, only a known caller is read, and only a few at once, with
  // /api/mcp (platform/large-bodies.ts): an anonymous or refused request is
  // answered once 2 MiB are read, plus the chunk that crossed that mark,
  // which is never kept.
  const place: { release?: () => void } = {};
  const enterLarge = async (): Promise<Response | null> => {
    try {
      await authenticate(incoming.headers);
    } catch (error) {
      if (error instanceof ORPCError) return errorResponse(error);
      throw error;
    }
    const release = takeLargeBodyPlace();
    if (!release) return errorResponse(largeBodyBusy(), { "Retry-After": "1" });
    place.release = release;
    return null;
  };

  try {
    const bounded = await withBoundedBody(
      incoming,
      larger?.maxBytes ?? OPENAPI_MAX_BODY_BYTES,
      enterLarge,
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
  } finally {
    place.release?.();
  }
}

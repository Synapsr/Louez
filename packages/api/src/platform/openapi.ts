import { OpenAPIGenerator, type OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError, ORPCError, type AnyRouter } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import type { BaseContext } from "../context";
import { resolveAccountActor } from "./actor";
import { reportUnexpectedErrors } from "./error-reporting";
import { largeBodyBusy, takeLargeBodyPlace } from "./large-bodies";
import type { ApiErrorData } from "./errors";
import type { ExposedProcedure } from "./exposure";
import { sha256 } from "./hash";
import type { OperationReceipt } from "./operations";
import type { ApiPorts } from "./ports";
import { API_RATE_LIMIT } from "./rate-limit";

/** Response header with the id of the operation a write recorded (its receipt). */
export const OPERATION_ID_HEADER = "Louez-Operation-Id";
/** Response header set to `true` when an idempotency key replayed a stored result. */
export const REPLAYED_HEADER = "Louez-Replayed";

/** Where the app mounts the OpenAPI transport. */
export const OPENAPI_PREFIX = "/api/v1";

/** Where `/api/v1` serves its OpenAPI document, and the reference that renders it. */
export const OPENAPI_DOCUMENT_PATH = "/openapi.json";
export const OPENAPI_REFERENCE_PATH = "/docs";

/** `info.version`: the first version of `/api/v1`, in beta until it is declared stable. */
export const OPENAPI_VERSION = "1.0.0-beta";

/** Where changes to the API are announced: the repository's changelog. */
export const API_CHANGELOG_URL = "https://github.com/Synapsr/Louez/blob/main/CHANGELOG.md";

/** The dashboard page where a store owner creates API keys (its "API keys" section). */
export const API_KEYS_PAGE_PATH = "/dashboard/settings/integrations/mcp";

/**
 * The reference's renderer, Scalar, from jsDelivr: pinned to one file, which
 * the browser runs only if it matches this hash.
 */
const REFERENCE_SCRIPT = {
  url: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.0/dist/browser/standalone.js",
  integrity: "sha384-oH1C0RwqcwbVXkC+r8A+4qRoyEUQdtxAzOwumkxZtQBBcsy61FOoPt7B50OVJYYQ",
};

/**
 * How long a client or a shared cache may keep the document and the
 * reference: they change only with a deployment.
 */
const REFERENCE_CACHE_CONTROL = "public, max-age=300";

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
 * What the reference shows first, and every reader of the document gets: the
 * API is in beta, and what that means.
 */
export const OPENAPI_BETA_NOTICE = `> **Beta.** The Louez REST API is in beta. It runs in production, but its operations may still change: new operations and new fields come often, and an operation may still be renamed, changed or removed. Every such change is announced in the [Louez changelog](${API_CHANGELOG_URL}).
>
> What does not change without notice: the \`/api/v1\` base path, authentication with an API key, the error format and its \`data.code\` values, and the \`Idempotency-Key\` and \`Louez-Confirmation\` headers. An answer may gain fields at any time: ignore the ones you do not know. The version \`${OPENAPI_VERSION}\` marks the first version of \`/api/v1\`, before it is declared stable.`;

const OPENAPI_DESCRIPTION = `${OPENAPI_BETA_NOTICE}

Every action of the Louez dashboard, for scripts and integrations: products, reservations, settings, the online store and more. The same operations serve Louez's MCP server for AI assistants, so an operation's \`operationId\` is also its MCP tool name, and descriptions name other operations by it, such as \`products_get\`.

## Authentication

Send an API key in the \`Authorization\` header: \`Bearer lz_…\`. A store owner creates keys in the Louez dashboard, under Settings > Integrations > MCP, in the API keys section (\`${API_KEYS_PAGE_PATH}\`), and chooses what each key may read and change. The key is shown once. It works on its own store only; an operation outside its rights answers \`PERMISSION_DENIED\`. OAuth access tokens are for the MCP server: this API refuses them with \`CREDENTIAL_NOT_ACCEPTED\`.

## Errors

An error answers with its HTTP status and a JSON body: \`code\` (the HTTP-level code, such as \`FORBIDDEN\`), \`status\`, \`message\` (plain English, safe to show) and \`data\`. Branch on \`data.code\`, a stable code such as \`PRODUCT_NOT_FOUND\`. \`data.retryable\` says whether the same call can succeed later unchanged, and \`data.details\` holds the facts behind the error. An input the operation does not accept answers 400 \`BAD_REQUEST\` with \`data.issues\`, one per field at fault, and no \`data.code\`. Each operation names its own codes in its description; every integration should handle these:

| Status | \`data.code\` | Meaning |
| --- | --- | --- |
| 401 | \`UNAUTHENTICATED\` | No API key, or one that is invalid, expired or revoked. |
| 401 | \`CREDENTIAL_NOT_ACCEPTED\` | The credential is not an API key. |
| 403 | \`PERMISSION_DENIED\` | The key's rights or its owner's role do not allow it; \`details.required\` says what is needed. |
| 403 | \`API_ACCESS_NOT_IN_PLAN\` | The store's plan does not include the API. |
| 409 | \`IDEMPOTENCY_KEY_REUSED\` | The idempotency key was used with another input. |
| 409 | \`OPERATION_IN_PROGRESS\` | The same write is still running: retry shortly with the same idempotency key. |
| 409 | \`OPERATION_OUTCOME_UNKNOWN\` | An earlier call with this idempotency key may have gone through: check the current state before trying again with a new key. |
| 412 | \`CONFIRMATION_REQUIRED\` | The write waits for a confirmation (below). |
| 412 | \`CONFIRMATION_INVALID\` | The confirmation token is unknown, expired, used, or no longer matches: call again without it for a new preview. |
| 413 | \`REQUEST_TOO_LARGE\` | The body is larger than the operation takes (\`details.maxBytes\`). |
| 429 | \`RATE_LIMITED\` | Too many calls: retry after \`details.retryAfterSeconds\`. |
| 503 | \`LARGE_BODY_BUSY\` | Too many large bodies are being read: retry after the \`Retry-After\` header. |

## Confirmations

Some writes change what customers see or pay, or cannot be undone; their description says so and they take the \`Louez-Confirmation\` header. On a key that asks for confirmations (the default; an option of each key), their first call changes nothing and answers 412 \`CONFIRMATION_REQUIRED\`: \`message\` says what would happen, \`data.details.preview\` lists the facts to check, and \`data.details.confirmationToken\` is the token. Show the preview to the person who decides, then send the same request again with the token in the \`Louez-Confirmation\` header. A token works once, for ten minutes, for the same key, input and state. A few operations always ask, whatever the key's option; their description says so.

## Idempotency and receipts

A write takes an optional \`Idempotency-Key\` header, 1 to 100 characters. Use a new key for each write you mean, and the same key for its retries: the same key with the same input returns the stored result without running again, with \`Louez-Replayed: true\`; with another input it answers \`IDEMPOTENCY_KEY_REUSED\`. Every write answers with \`Louez-Operation-Id\`, the id of the operation it recorded.

## Limits

A key makes up to ${API_RATE_LIMIT.max} calls a minute, counted together with its MCP calls. A request body is at most 2 MiB, unless the operation says it takes more (an image's bytes, a product with its units). Lists are paged: pass the \`nextCursor\` of an answer as \`cursor\` to read on.`;

/**
 * The parts of the `/api/v1` document that do not come from the procedures:
 * the beta notice and the guide to the API, the API key scheme, the
 * idempotency and confirmation headers, the receipt headers, and the error
 * body every transport sends.
 */
const openApiDocumentOptions = {
  info: {
    title: "Louez API",
    version: OPENAPI_VERSION,
    description: OPENAPI_DESCRIPTION,
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
        description:
          "What the error is about. Every error has `code` and `retryable`, except a 400 for an input the operation does not accept, which has `issues` instead.",
        properties: {
          code: {
            type: "string",
            description: "Stable code to branch on, such as PERMISSION_DENIED.",
          },
          retryable: { type: "boolean", description: "Whether the same call can succeed later." },
          i18nKey: { type: "string" },
          details: { type: "object", additionalProperties: true },
          issues: {
            type: "array",
            description:
              "For an input the operation does not accept: one entry per field at fault.",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                path: { type: "array", items: { type: ["string", "number"] } },
                message: { type: "string" },
              },
            },
          },
        },
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
 * never the whole router. Its document and reference are `createApiReference`.
 */
export function createOpenApiHandler(
  router: AnyRouter,
  options: { onError?: (error: unknown) => void } = {},
): OpenAPIHandler<BaseContext> {
  return new OpenAPIHandler<BaseContext>(router, {
    interceptors: options.onError ? [onError(options.onError)] : [],
    // An unexpected error reaches error tracking through `ports.reportError`.
    clientInterceptors: [reportUnexpectedErrors],
  });
}

/** A document or a page, ready to answer as is. */
interface ServedFile {
  body: string;
  contentType: string;
  etag: string;
}

const servedFile = (body: string, contentType: string): ServedFile => ({
  body,
  contentType,
  etag: `"${sha256(body).slice(0, 32)}"`,
});

/** Whether `If-None-Match` names this ETag: the client's copy is current. */
function isCurrent(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === etag || tag === "*");
}

/**
 * The reference page: Scalar renders the document, read from the same origin.
 * The beta notice heads the document's description, which Scalar shows first.
 */
function referenceHtml(documentPath: string): string {
  const config = {
    url: documentPath,
    // Scalar's usage telemetry and its AI chat stay off.
    telemetry: false,
    agent: { disabled: true },
  };
  const script = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${openApiDocumentOptions.info.title} reference (beta)</title>
    <meta name="description" content="The REST API of Louez, the rental management software: every operation, its input and its answer. In beta." />
  </head>
  <body>
    <div id="app"></div>
    <noscript>This reference needs JavaScript. The OpenAPI document itself is at <a href="${documentPath}">${documentPath}</a>.</noscript>
    <script src="${REFERENCE_SCRIPT.url}" integrity="${REFERENCE_SCRIPT.integrity}" crossorigin="anonymous"></script>
    <script>Scalar.createApiReference("#app", ${script});</script>
  </body>
</html>
`;
}

/** Serves the OpenAPI document and its reference page to anyone, without a key. */
export interface ApiReference {
  /**
   * The answer to `request` when it asks for the document
   * (`OPENAPI_DOCUMENT_PATH`) or the reference (`OPENAPI_REFERENCE_PATH`),
   * `path` being the request's path under `prefix`; null otherwise. The
   * document names `serverUrl`, the public URL of `/api/v1` on this
   * deployment, as its server.
   */
  serve(
    request: Request,
    at: { path: string; prefix: string; serverUrl: string },
  ): Promise<Response | null>;
}

/**
 * The document of `router` and its reference page. The document is generated
 * once per process and server URL (the app's weighs about 340 KB and takes
 * tens of milliseconds), then answered from memory, with an ETag and a
 * public cache lifetime: it changes only with a deployment.
 */
export function createApiReference(router: AnyRouter): ApiReference {
  let cached: { serverUrl: string; document: Promise<ServedFile> } | undefined;
  const documentFor = (serverUrl: string): Promise<ServedFile> => {
    if (cached?.serverUrl === serverUrl) return cached.document;
    const document = generateOpenApiDocument(router, serverUrl).then((generated) =>
      servedFile(JSON.stringify(generated), "application/json; charset=utf-8"),
    );
    cached = { serverUrl, document };
    // A failed generation is tried again on the next request.
    document.catch(() => {
      if (cached?.document === document) cached = undefined;
    });
    return document;
  };

  return {
    async serve(request, { path, prefix, serverUrl }) {
      if (request.method !== "GET" && request.method !== "HEAD") return null;
      const route = path.replace(/\/+$/, "");
      let file: ServedFile;
      if (route === OPENAPI_DOCUMENT_PATH) file = await documentFor(serverUrl);
      else if (route === OPENAPI_REFERENCE_PATH) {
        file = servedFile(
          referenceHtml(`${prefix}${OPENAPI_DOCUMENT_PATH}`),
          "text/html; charset=utf-8",
        );
      } else return null;

      const headers = new Headers({
        "Content-Type": file.contentType,
        "Cache-Control": REFERENCE_CACHE_CONTROL,
        ETag: file.etag,
      });
      // A public document: any site may read it, without credentials.
      if (route === OPENAPI_DOCUMENT_PATH) headers.set("Access-Control-Allow-Origin", "*");
      if (isCurrent(request, file.etag)) return new Response(null, { status: 304, headers });
      return new Response(request.method === "HEAD" ? null : file.body, { status: 200, headers });
    },
  };
}

/**
 * Serves one request with an API key: the transport is `openapi`, and a write
 * answers with its receipt in the `Louez-Operation-Id` header (and
 * `Louez-Replayed: true` when an idempotency key replayed it). Errors keep
 * oRPC's JSON shape, with our `data` (code, retryable, i18nKey, details).
 * With `reference`, it also serves the OpenAPI document and its reference
 * page, to anyone; their server is this deployment's `ports.urls`. Undefined
 * when nothing matches.
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
    /** The document and its reference (`createApiReference`), served before any procedure. */
    reference?: ApiReference;
  },
): Promise<Response | undefined> {
  const prefix = options.prefix ?? OPENAPI_PREFIX;
  const { pathname } = new URL(incoming.url);
  const path = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  if (options.reference) {
    const served = await options.reference.serve(incoming, {
      path,
      prefix,
      serverUrl: options.ports.urls.dashboard(prefix),
    });
    if (served) return served;
  }
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

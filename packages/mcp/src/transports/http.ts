import type { ExposedProcedure } from "@louez/api/platform/exposure";
import type { ApiPorts } from "@louez/api/platform/ports";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

import type { AccountActor } from "@louez/api/platform/actor";
import { platformErrors } from "@louez/api/platform/errors";
import { STORE_HEADER } from "@louez/api/platform/procedures";
import { consumeRateLimit, rateLimitKey, rateLimitReached } from "@louez/api/platform/rate-limit";

import type { McpRequestContext } from "../auth/context";
import { resolveMcpAccount, resolveMcpContext } from "../auth/resolve";
import type { McpServerDeps } from "../deps";
import { createMcpServer } from "../server";

export interface McpHttpOptions {
  /** What the app lends the hand-written tools. */
  deps: McpServerDeps;
  /** What the app lends the procedures (`apiPorts`). */
  ports: ApiPorts;
  /** The procedures served as tools (`createExposure(appRouter).procedures`). */
  procedures: readonly ExposedProcedure[];
  /**
   * RFC 9728 metadata of this resource, announced on a 401 so an MCP client
   * finds where to sign in (OAuth). Absent when the instance serves no OAuth.
   */
  resourceMetadataUrl?: string;
}

/**
 * The challenge of a 401: Bearer, with the resource metadata an MCP client
 * starts OAuth from, and `invalid_token` when a token was sent but refused.
 */
function bearerChallenge(request: Request, resourceMetadataUrl: string | undefined): string {
  const parts = ['realm="louez"'];
  if (resourceMetadataUrl) parts.push(`resource_metadata="${resourceMetadataUrl}"`);
  if (request.headers.get("authorization")) parts.push('error="invalid_token"');
  return `Bearer ${parts.join(", ")}`;
}

/** A platform error as the HTTP answer of a request that never reached MCP. */
function errorResponse(error: ORPCError<string, unknown>, challenge: string): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (error.status === 401) headers.set("WWW-Authenticate", challenge);
  const retryAfter = (error.data as { details?: { retryAfterSeconds?: number } } | undefined)
    ?.details?.retryAfterSeconds;
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return new Response(JSON.stringify(error.toJSON()), { status: error.status, headers });
}

/** The SDK's own limit on a request body; this handler parses before it does. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The limit of a request that calls one tool taking a file's bytes
 * (`meta.mcp.inlineFile`, such as categories_upload_image): a 5 MB image is
 * 6.7 MB of base64, with the call around it.
 */
export const INLINE_FILE_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Calls a body past `MAX_BODY_BYTES` counts on the connection's rate limit,
 * before more of it is read: whether it is a call that may be that large is
 * known only once it is parsed, so each such read costs as much as four
 * calls, whatever it turns out to be.
 */
export const OVERSIZED_BODY_WEIGHT = 4;

const TOO_LARGE_MESSAGE = `Request body too large: at most ${MAX_BODY_BYTES} bytes, or ${INLINE_FILE_REQUEST_MAX_BYTES} for one call to a tool that takes a file's bytes (an image of 5 MB at most). Send a larger image as a public imageUrl.`;

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type ReadBody =
  | { kind: "none" }
  | { kind: "json"; value: unknown; size: number; counted: boolean }
  | { kind: "too-large"; counted: boolean }
  | { kind: "invalid" };

/**
 * Reads a POST body as JSON, streaming, at most `MAX_BODY_BYTES`. Past it,
 * and only when `oversized` is given, it first has the oversized read
 * counted (which throws when the rate limit refuses it), then reads on up to
 * `oversized.maxBytes`. The body is consumed here and handed to the SDK
 * parsed.
 */
async function readJson(
  request: Request,
  oversized?: { maxBytes: number; count: () => Promise<void> },
): Promise<ReadBody> {
  if (request.method !== "POST" || !request.body) return { kind: "none" };
  const limit = oversized?.maxBytes ?? MAX_BODY_BYTES;
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit) return { kind: "too-large", counted: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let counted = false;
  try {
    if (oversized && declared > MAX_BODY_BYTES) {
      await oversized.count();
      counted = true;
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel();
        return { kind: "too-large", counted };
      }
      if (oversized && !counted && size > MAX_BODY_BYTES) {
        await oversized.count();
        counted = true;
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel();
    throw error;
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { kind: "json", value, size, counted };
  } catch {
    return { kind: "invalid" };
  }
}

/** Whether the body is one call to one of `tools`: alone, it may pass `MAX_BODY_BYTES`. */
function isSingleCallTo(body: unknown, tools: ReadonlySet<string>): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const { method, params } = body as { method?: unknown; params?: unknown };
  const name = (params as { name?: unknown } | undefined)?.name;
  return method === "tools/call" && typeof name === "string" && tools.has(name);
}

/**
 * How many messages of the request count on the rate limit here. A tool call
 * counts when it runs (in the procedure, or in the hand-written tool); every
 * other message, batched or not, counts here.
 */
function callsToCount(body: unknown): number {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter(
    (message) =>
      !(
        typeof message === "object" &&
        message !== null &&
        (message as { method?: unknown }).method === "tools/call"
      ),
  ).length;
}

/**
 * The store a request names in its body: the `storeId` argument of its tool
 * calls. Every tool call of a batch must name the same one.
 */
function storeArgument(body: unknown): { storeId?: string } | { conflict: true } {
  const messages = Array.isArray(body) ? body : [body];
  const named = new Set<string>();
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const { method, params } = message as { method?: unknown; params?: unknown };
    if (method !== "tools/call") continue;
    const storeId = (params as { arguments?: { storeId?: unknown } } | undefined)?.arguments
      ?.storeId;
    if (typeof storeId === "string" && storeId.length > 0) named.add(storeId);
  }
  if (named.size > 1) return { conflict: true };
  return { storeId: [...named][0] };
}

/**
 * Serves one MCP request over Streamable HTTP, statelessly: no session is
 * kept between requests. Each request resolves its own context (the key or
 * the access token is checked, the grant, the store and the role read again,
 * the plan's API access checked) and gets a server built for it, so a revoked
 * key or grant, or a lower role, applies on the next request.
 *
 * Requests that fail authentication never reach MCP: they get the platform's
 * error as JSON, with its HTTP status.
 */
export async function handleMcpRequest(
  request: Request,
  options: McpHttpOptions,
): Promise<Response> {
  // Who calls comes first: an anonymous request is refused before its body
  // is read.
  const challenge = bearerChallenge(request, options.resourceMetadataUrl);
  let account: AccountActor;
  try {
    account = await resolveMcpAccount(request.headers);
  } catch (error) {
    if (error instanceof ORPCError) return errorResponse(error, challenge);
    throw error;
  }

  // The connection's rate limit applies before the body is read: one that
  // used up its window gets no read at all. A body refused here, too large
  // or not JSON, counts as a call; a body past 4 MiB counts as
  // OVERSIZED_BODY_WEIGHT calls before the rest of it is read.
  const limitKey = rateLimitKey(account.credential);
  const count = async (weight = 1) => {
    const limit = await consumeRateLimit(limitKey, undefined, undefined, weight);
    if (!limit.allowed) throw platformErrors.rateLimited(limit.retryAfterSeconds);
  };
  let body: ReadBody;
  try {
    const reached = await rateLimitReached(limitKey);
    if (reached) throw platformErrors.rateLimited(reached.retryAfterSeconds);

    // A call to a tool that takes a file's bytes may be larger; nothing else.
    const inlineFileTools = new Set(
      options.procedures.filter(({ meta }) => meta.mcp.inlineFile).map(({ meta }) => meta.mcp.name),
    );
    body = await readJson(
      request,
      inlineFileTools.size > 0
        ? {
            maxBytes: INLINE_FILE_REQUEST_MAX_BYTES,
            count: () => count(OVERSIZED_BODY_WEIGHT),
          }
        : undefined,
    );
    if (
      body.kind === "too-large" ||
      (body.kind === "json" &&
        body.size > MAX_BODY_BYTES &&
        !isSingleCallTo(body.value, inlineFileTools))
    ) {
      if (!body.counted) await count();
      return jsonResponse({ error: TOO_LARGE_MESSAGE }, 413);
    }
    if (body.kind === "invalid") {
      await count();
      return jsonResponse(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        400,
      );
    }
  } catch (error) {
    if (error instanceof ORPCError) return errorResponse(error, challenge);
    throw error;
  }

  // The store: the header, else the `storeId` argument of the tool call.
  const named = body.kind === "json" ? storeArgument(body.value) : {};
  const header = request.headers.get(STORE_HEADER) ?? undefined;
  if ("conflict" in named || (header && named.storeId && named.storeId !== header)) {
    return jsonResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32602, message: "The tool calls of one request must name one store." },
      },
      400,
    );
  }

  let ctx: McpRequestContext;
  try {
    const base = { account, headers: request.headers, ports: options.ports };
    try {
      ctx = await resolveMcpContext({ ...base, requestedStoreId: header ?? named.storeId });
    } catch (error) {
      // A store named by a tool argument that the connection does not reach:
      // the tool call answers with the refusal, so the model can pick another.
      if (header || !named.storeId || !(error instanceof ORPCError) || error.status !== 403) {
        throw error;
      }
      ctx = await resolveMcpContext({ ...base, storeError: error });
    }
    const count = body.kind === "json" ? callsToCount(body.value) : 1;
    for (let left = count; left > 0; left -= 1) await ctx.countCall();
  } catch (error) {
    if (error instanceof ORPCError) return errorResponse(error, challenge);
    throw error;
  }

  // One handler per request, bound to this request's context. It keeps
  // nothing once the answer is sent. GET and DELETE (2025 session operations)
  // get 405 from the SDK: there is no session to stream on or to close.
  const handler = createMcpHandler(() => createMcpServer(ctx, options.deps, options.procedures), {
    legacy: "stateless",
  });
  return handler.fetch(request, body.kind === "json" ? { parsedBody: body.value } : undefined);
}

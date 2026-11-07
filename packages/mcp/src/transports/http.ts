import type { ExposedProcedure } from "@louez/api/platform/exposure";
import type { ApiPorts } from "@louez/api/platform/ports";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";

import type { McpRequestContext } from "../auth/context";
import { resolveMcpContext } from "../auth/resolve";
import type { McpServerDeps } from "../deps";
import { createMcpServer } from "../server";

export interface McpHttpOptions {
  /** What the app lends the hand-written tools. */
  deps: McpServerDeps;
  /** What the app lends the procedures (`apiPorts`). */
  ports: ApiPorts;
  /** The procedures served as tools (`createExposure(appRouter).procedures`). */
  procedures: readonly ExposedProcedure[];
}

/** A platform error as the HTTP answer of a request that never reached MCP. */
function errorResponse(error: ORPCError<string, unknown>): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (error.status === 401) headers.set("WWW-Authenticate", 'Bearer realm="louez"');
  const retryAfter = (error.data as { details?: { retryAfterSeconds?: number } } | undefined)
    ?.details?.retryAfterSeconds;
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return new Response(JSON.stringify(error.toJSON()), { status: error.status, headers });
}

/** The SDK's own limit on a request body; this handler parses before it does. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type ReadBody =
  | { kind: "none" }
  | { kind: "json"; value: unknown }
  | { kind: "too-large" }
  | { kind: "invalid" };

/**
 * Reads a POST body as JSON, at most `MAX_BODY_BYTES`, stopping as soon as it
 * goes past. The body is consumed here and handed to the SDK parsed.
 */
async function readJson(request: Request): Promise<ReadBody> {
  if (request.method !== "POST" || !request.body) return { kind: "none" };
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return { kind: "too-large" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      void reader.cancel();
      return { kind: "too-large" };
    }
    chunks.push(value);
  }
  try {
    return { kind: "json", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { kind: "invalid" };
  }
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
 * Serves one MCP request over Streamable HTTP, statelessly: no session is
 * kept between requests. Each request resolves its own context (the key is
 * checked, the store and the role read again, the plan's API access checked)
 * and gets a server built for it, so a revoked key or a lower role applies on
 * the next request.
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
  let ctx: McpRequestContext;
  try {
    ctx = await resolveMcpContext({ headers: request.headers, ports: options.ports });
  } catch (error) {
    if (error instanceof ORPCError) return errorResponse(error);
    throw error;
  }

  const body = await readJson(request);
  if (body.kind === "too-large") return jsonResponse({ error: "Request body too large." }, 413);
  if (body.kind === "invalid") {
    return jsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }
  try {
    const count = body.kind === "json" ? callsToCount(body.value) : 1;
    for (let left = count; left > 0; left -= 1) await ctx.countCall();
  } catch (error) {
    if (error instanceof ORPCError) return errorResponse(error);
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

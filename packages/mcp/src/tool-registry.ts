import type { McpToolAnnotations } from "@louez/api/platform/meta";
import {
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type McpServer,
  type Tool,
} from "@modelcontextprotocol/server";

import type { McpRequestContext } from "./auth/context";
import { errorResult, reportToolError } from "./utils/errors";

/** A tool as this server serves it. */
export interface ServedTool {
  name: string;
  /** A short human title, in English Title Case. */
  title: string;
  description: string;
  /** JSON Schema of the arguments; always an object. */
  inputSchema: Tool["inputSchema"];
  /** JSON Schema of `structuredContent` on success, when the tool returns some. */
  outputSchema?: Tool["outputSchema"];
  /** Every hint as an explicit boolean: the Claude and ChatGPT directories require them. */
  annotations: McpToolAnnotations;
  /** Tool `_meta` beyond the security schemes, which every tool gets. */
  meta?: Record<string, unknown>;
  /**
   * Shown by `tools/list`. A tool that is not listed can still be called:
   * the list only shows, the call is authorized where it runs.
   */
  listed: boolean;
  call: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * How a client signs in to call any tool (ChatGPT reads it per tool): OAuth.
 * What a connection may do is the grant the user accepted on the consent page,
 * not an OAuth scope, so no scope is asked for. An instance without OAuth
 * (plain HTTP) declares none: it takes API keys only.
 */
const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: [] }] as const;

/** Tool result `_meta` key that makes ChatGPT ask the user to sign in again. */
export const WWW_AUTHENTICATE_META = "mcp/www_authenticate";

/**
 * Error codes a new sign-in fixes: the access token expired, or its grant was
 * revoked, between the request's check and the call. A refusal of rights
 * (PERMISSION_DENIED, NO_STORE_ACCESS) gets no challenge: signing in again
 * keeps the same grant, which only the user changes, in Louez.
 */
const SIGN_IN_AGAIN_CODES = new Set(["UNAUTHENTICATED", "CREDENTIAL_NOT_ACCEPTED"]);

interface Registry {
  tools: Map<string, ServedTool>;
  /** The request's context, shared by every tool of this server. */
  ctx: McpRequestContext;
  /** RFC 9728 metadata of this resource; absent when the instance serves no OAuth. */
  resourceMetadataUrl: string | undefined;
}

const registries = new WeakMap<McpServer, Registry>();

/**
 * Serves `tools/list` and `tools/call` from our own list instead of the SDK's
 * `registerTool`, which cannot show a subset of what may be called. Resources
 * and prompts stay on the SDK. Add every tool before the server connects.
 */
export function addTool(server: McpServer, ctx: McpRequestContext, tool: ServedTool): void {
  let registry = registries.get(server);
  if (!registry) {
    const created: Registry = {
      tools: new Map(),
      ctx,
      resourceMetadataUrl: ctx.resourceMetadataUrl,
    };
    install(server, created);
    registries.set(server, created);
    registry = created;
  }
  if (registry.tools.has(tool.name)) throw new Error(`MCP tool ${tool.name} is registered twice.`);
  registry.tools.set(tool.name, tool);
}

/** A tool as `tools/list` shows it, with ChatGPT's `securitySchemes`. */
function listed(
  tool: ServedTool,
  resourceMetadataUrl: string | undefined,
): Tool & { securitySchemes?: typeof OAUTH_SECURITY_SCHEMES } {
  const securitySchemes = resourceMetadataUrl ? OAUTH_SECURITY_SCHEMES : undefined;
  const meta = { ...(securitySchemes ? { securitySchemes } : {}), ...tool.meta };
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    annotations: { title: tool.title, ...tool.annotations },
    // ChatGPT reads the schemes from `_meta`; its profile example also sets
    // them on the tool itself.
    ...(securitySchemes ? { securitySchemes } : {}),
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

/**
 * A failed call that signing in again fixes carries the challenge ChatGPT
 * starts its sign-in from: the same one as a 401 at the door.
 */
function withChallenge(result: CallToolResult, resourceMetadataUrl: string | undefined) {
  if (!resourceMetadataUrl || !result.isError) return result;
  const code = (result.structuredContent as { error?: { code?: unknown } } | undefined)?.error
    ?.code;
  if (typeof code !== "string" || !SIGN_IN_AGAIN_CODES.has(code)) return result;
  const challenge = `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="The access token expired or was revoked. Sign in to Louez again."`;
  return { ...result, _meta: { ...result._meta, [WWW_AUTHENTICATE_META]: [challenge] } };
}

function install(server: McpServer, registry: Registry): void {
  const lowLevel = server.server;
  lowLevel.registerCapabilities({ tools: { listChanged: false } });

  lowLevel.setRequestHandler("tools/list", () => ({
    tools: [...registry.tools.values()]
      .filter((tool) => tool.listed)
      .map((tool) => listed(tool, registry.resourceMetadataUrl)),
  }));

  lowLevel.setRequestHandler("tools/call", async (request) => {
    const tool = registry.tools.get(request.params.name);
    if (!tool) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Tool ${request.params.name} not found`,
      );
    }
    let result: CallToolResult;
    try {
      result = await tool.call(request.params.arguments ?? {});
    } catch (error) {
      // An error no tool expected: described without its internals.
      reportToolError(registry.ctx, tool.name, error);
      result = errorResult(tool.name, error);
    }
    // Shapes the result for the protocol revision this request speaks.
    return lowLevel.projectCallToolResult(
      withChallenge(result, registry.resourceMetadataUrl),
      undefined,
    );
  });
}

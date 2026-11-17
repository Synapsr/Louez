import type { CallToolResult, McpServer, Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import { apiError, platformErrors } from "@louez/api/platform/errors";
import {
  mcpToolAnnotations,
  type McpBundle,
  type McpEffect,
  type McpReach,
} from "@louez/api/platform/meta";
import type { ApiDomain, ProcedureScope } from "@louez/api/platform/permissions";

import { isListed, requirePermission, type McpRequestContext } from "../auth/context";
import { STORE_ARGUMENT } from "../bridge";
import { addTool } from "../tool-registry";
import { errorResult, reportToolError } from "./errors";

/**
 * The bundle a hand-written tool is listed in, from its domain: the day's
 * operations (reservations, customers, payments, figures), the catalog, the
 * settings. The procedures that replace them declare theirs.
 */
const BUNDLE_OF_DOMAIN: Record<ApiDomain, McpBundle> = {
  reservations: "daily",
  customers: "daily",
  payments: "daily",
  analytics: "daily",
  products: "catalog",
  categories: "catalog",
  settings: "settings",
  online_store: "settings",
  integrations: "integrations",
  team: "team",
  billing: "billing",
  stores: "daily",
};

/**
 * Registers one of the hand-written tools that predate the bridge. They move
 * to procedures domain by domain; until then each call counts on the
 * connection's shared rate limit, `scope` is checked like a procedure's (the
 * member's role cut down to the connection's scopes) and, with the bundle of
 * its domain, decides whether the tool is listed, and a platform error
 * (permission denied, rate limited, store required) answers in the bridge's
 * format. On a connection over several stores it takes `storeId`, read when
 * the request came in. Its hints are derived as a procedure's are
 * (`mcpToolAnnotations`): from `scope`, and for a write from `tool.effect`;
 * `tool.reach` when it reaches outside Louez.
 */
export function legacyTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  ctx: McpRequestContext,
  scope: ProcedureScope,
  tool: { name: string; title: string; effect?: McpEffect; reach?: McpReach },
  description: string,
  shape: Shape,
  handler: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
): void {
  const schema = z.object(shape);
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(schema, { io: "input" });
  if (ctx.storeArgument) {
    inputSchema.properties = { ...inputSchema.properties, storeId: STORE_ARGUMENT };
  }
  const { name, title } = tool;
  if ((scope.level === "write") !== (tool.effect !== undefined)) {
    throw new Error(`MCP tool ${name}: a write declares its effect, a read none.`);
  }
  addTool(server, ctx, {
    name,
    title,
    description,
    inputSchema: inputSchema as Tool["inputSchema"],
    annotations: mcpToolAnnotations({ level: scope.level, effect: tool.effect, reach: tool.reach }),
    listed: isListed(ctx, scope, BUNDLE_OF_DOMAIN[scope.domain]),
    call: async ({ storeId: _store, ...args }) => {
      if (ctx.storeError) return errorResult(name, ctx.storeError);
      if (!ctx.storeChosen) return errorResult(name, platformErrors.storeRequired());
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          name,
          apiError("BAD_REQUEST", "INVALID_ARGUMENT", {
            message: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`,
            details: { issues: parsed.error.issues },
          }),
        );
      }
      try {
        requirePermission(ctx, scope.domain, scope.level, scope.role);
        await ctx.countCall();
        return await handler(parsed.data);
      } catch (error) {
        reportToolError(ctx, name, error);
        return errorResult(name, error);
      }
    },
  });
}

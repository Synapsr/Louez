import type { CallToolResult, McpServer, Tool } from "@modelcontextprotocol/server";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { ProcedureScope } from "@louez/api/platform/permissions";

import { hasPermission, requirePermission, type McpRequestContext } from "../auth/context";
import { addTool } from "../tool-registry";
import { errorResult } from "./errors";

/**
 * Registers one of the hand-written tools that predate the bridge. They move
 * to procedures domain by domain; until then each call counts on the
 * connection's shared rate limit, `scope` is checked like a procedure's (the
 * member's role cut down to the connection's scopes) and decides whether the
 * tool is listed, and a platform error (permission denied, rate limited)
 * answers in the bridge's format.
 */
export function legacyTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  ctx: McpRequestContext,
  scope: ProcedureScope,
  name: string,
  description: string,
  shape: Shape,
  handler: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
): void {
  const schema = z.object(shape);
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(schema, { io: "input" });
  addTool(server, {
    name,
    description,
    inputSchema: inputSchema as Tool["inputSchema"],
    listed: hasPermission(ctx, scope.domain, scope.level, scope.role),
    call: async (args) => {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        throw new Error(
          `Input validation error: Invalid arguments for tool ${name}: ${z.prettifyError(parsed.error)}`,
        );
      }
      try {
        requirePermission(ctx, scope.domain, scope.level, scope.role);
        await ctx.countCall();
        return await handler(parsed.data);
      } catch (error) {
        if (error instanceof ORPCError) return errorResult(name, error);
        throw error;
      }
    },
  });
}

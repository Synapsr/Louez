import type { CallToolResult, McpServer, Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  CONFIRMATION_HEADER,
  requireConfirmation,
  type ConfirmationPreview,
} from "@louez/api/platform/confirmation";
import { apiError, platformErrors } from "@louez/api/platform/errors";
import {
  mcpToolAnnotations,
  type McpBundle,
  type McpToolAnnotations,
  type SensitiveKind,
} from "@louez/api/platform/meta";
import type { ApiDomain, ProcedureScope } from "@louez/api/platform/permissions";

import { isListed, requirePermission, type McpRequestContext } from "../auth/context";
import { CONFIRMATION_ARGUMENT, STORE_ARGUMENT } from "../bridge";
import { addTool } from "../tool-registry";
import { errorResult } from "./errors";

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
 * A hand-written tool that moves money, deletes, sends to a customer or
 * spends: it asks for a confirmation first, as a sensitive procedure does,
 * when the connection wants one.
 */
export interface LegacySensitive<Args> {
  kind: SensitiveKind;
  /**
   * What the call will do, on which record, and the business state the
   * preview shows (status, amounts): a token stops working once that state
   * changes. Null when there is nothing to confirm: the record is not there
   * (the handler then answers), or this call takes none of the tool's
   * sensitive paths (a plain edit runs directly).
   */
  confirm: (args: Args) => Promise<{ preview: ConfirmationPreview; state: unknown } | null>;
}

/**
 * Registers one of the hand-written tools that predate the bridge. They move
 * to procedures domain by domain; until then each call counts on the
 * connection's shared rate limit, `scope` is checked like a procedure's (the
 * member's role cut down to the connection's scopes) and, with the bundle of
 * its domain, decides whether the tool is listed, and a platform error
 * (permission denied, rate limited, store required) answers in the bridge's
 * format. On a connection over several stores it takes `storeId`, read when
 * the request came in. A `sensitive` tool takes `confirmationToken` and runs
 * through `requireConfirmation` before its handler. Its hints are derived as
 * a procedure's are (`mcpToolAnnotations`), from `scope` and `sensitive`;
 * `tool.annotations` corrects them.
 */
export function legacyTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  ctx: McpRequestContext,
  scope: ProcedureScope,
  tool: { name: string; title: string; annotations?: Partial<McpToolAnnotations> },
  description: string,
  shape: Shape,
  handler: (args: z.infer<z.ZodObject<Shape>>) => CallToolResult | Promise<CallToolResult>,
  options: { sensitive?: LegacySensitive<z.infer<z.ZodObject<Shape>>> } = {},
): void {
  const schema = z.object(shape);
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(schema, { io: "input" });
  if (ctx.storeArgument) {
    inputSchema.properties = { ...inputSchema.properties, storeId: STORE_ARGUMENT };
  }
  const { sensitive } = options;
  const { name, title } = tool;
  if (sensitive) {
    inputSchema.properties = {
      ...inputSchema.properties,
      confirmationToken: CONFIRMATION_ARGUMENT,
    };
  }
  addTool(server, ctx, {
    name,
    title,
    description,
    inputSchema: inputSchema as Tool["inputSchema"],
    annotations: mcpToolAnnotations({
      level: scope.level,
      sensitive: sensitive?.kind,
      overrides: tool.annotations,
    }),
    listed: isListed(ctx, scope, BUNDLE_OF_DOMAIN[scope.domain]),
    call: async ({ storeId: _store, confirmationToken, ...args }) => {
      if (ctx.storeError) return errorResult(name, ctx.storeError);
      if (!ctx.storeChosen) return errorResult(name, platformErrors.storeRequired());
      if (
        confirmationToken !== undefined &&
        (typeof confirmationToken !== "string" || confirmationToken.length === 0)
      ) {
        return errorResult(
          name,
          apiError("BAD_REQUEST", "INVALID_ARGUMENT", {
            message: "confirmationToken must be a non-empty string.",
            details: { argument: "confirmationToken" },
          }),
        );
      }
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
        // Known limit, accepted until these tools become procedures (lots
        // 2a/2c reservations and payments): the preview's state is
        // read and the token checked here, outside the transaction the
        // handler writes in, so a change landing between this check and the
        // write is not caught. A procedure asks under its domain's lock
        // instead (docs/architecture/api-and-agents.md, Hand-written tools).
        // A connection that runs directly needs no preview: skip its reads.
        if (sensitive && ctx.actor.credential.confirmSensitive) {
          const confirmation = await sensitive.confirm(parsed.data);
          if (confirmation) {
            const headers = new Headers();
            if (typeof confirmationToken === "string") {
              headers.set(CONFIRMATION_HEADER, confirmationToken);
            }
            await requireConfirmation({
              actor: ctx.actor,
              headers,
              procedure: `mcp.${name}`,
              input: parsed.data,
              state: confirmation.state,
              preview: {
                ...confirmation.preview,
                details: { sensitive: sensitive.kind, ...confirmation.preview.details },
              },
            });
          }
        }
        return await handler(parsed.data);
      } catch (error) {
        return errorResult(name, error);
      }
    },
  });
}

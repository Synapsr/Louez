import { CONFIRMATION_HEADER } from "@louez/api/platform/confirmation";
import type { ExposedProcedure } from "@louez/api/platform/exposure";
import { apiError } from "@louez/api/platform/errors";
import { IDEMPOTENCY_HEADER, type OperationReceipt } from "@louez/api/platform/operations";
import { allows } from "@louez/api/platform/permissions";
import { STORE_HEADER } from "@louez/api/platform/procedures";
import type { CallToolResult, McpServer, Tool } from "@modelcontextprotocol/server";
import { call } from "@orpc/server";

import type { McpRequestContext } from "./auth/context";
import { addTool } from "./tool-registry";
import { errorResult } from "./utils/errors";

/** `_meta` keys of a tool result. */
export const OPERATION_ID_META = "io.louez/operationId";
export const REPLAYED_META = "io.louez/replayed";

/**
 * The arguments of a tool: the procedure's input, plus the headers it maps.
 * Only listed: the procedure validates the input, as it does for RPC and
 * OpenAPI, so every transport answers a bad input with the same error.
 */
function toolInputSchema(entry: ExposedProcedure): Tool["inputSchema"] {
  const properties = { ...(entry.inputJsonSchema.properties as Record<string, unknown>) };
  if (entry.meta.scope.level === "write" && !entry.meta.secretOutput) {
    properties.idempotencyKey = {
      type: "string",
      minLength: 1,
      maxLength: 100,
      description:
        "Optional. A unique string for this action, such as a UUID. Retrying with the same key and the same arguments returns the first result instead of acting twice.",
    };
  }
  if (entry.meta.sensitive) {
    properties.confirmationToken = {
      type: "string",
      description:
        "Leave it out on the first call: the tool answers CONFIRMATION_REQUIRED with a preview and this token. After the user confirms, call again with the same arguments and the token.",
    };
  }
  return { ...entry.inputJsonSchema, properties } as Tool["inputSchema"];
}

// Dates become ISO strings, bigints decimal strings: structured content is JSON.
function jsonSafe(value: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      typeof entry === "bigint" ? entry.toString() : entry,
    ),
  ) as Record<string, unknown>;
}

/** Calls the procedure as the request's actor, with the arguments mapped onto headers. */
async function callProcedure(
  entry: ExposedProcedure,
  ctx: McpRequestContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { idempotencyKey, confirmationToken, ...input } = args;
  // A malformed control argument must not silently drop its protection (a
  // number as idempotency key would run the write twice): refuse the call.
  for (const [name, value] of [
    ["idempotencyKey", idempotencyKey],
    ["confirmationToken", confirmationToken],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
      return errorResult(
        entry.meta.mcp.name,
        apiError("BAD_REQUEST", "INVALID_ARGUMENT", {
          message: `${name} must be a non-empty string.`,
          details: { argument: name },
        }),
      );
    }
  }
  const headers = new Headers();
  for (const name of ["authorization", STORE_HEADER]) {
    const value = ctx.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (typeof idempotencyKey === "string") headers.set(IDEMPOTENCY_HEADER, idempotencyKey);
  if (typeof confirmationToken === "string") headers.set(CONFIRMATION_HEADER, confirmationToken);

  const receipt: OperationReceipt = {};
  try {
    const output = await call(entry.procedure, input, {
      context: { headers, transport: "mcp", ports: ctx.ports, receipt },
      path: entry.path.split("."),
    });
    const structuredContent = jsonSafe(output);
    const status = receipt.replayed ? "Done earlier (replayed)." : "Done.";
    const operation = receipt.operationId ? ` Operation ${receipt.operationId}.` : "";
    return {
      content: [
        { type: "text", text: `${status}${operation}\n${JSON.stringify(structuredContent)}` },
      ],
      structuredContent,
      ...(receipt.operationId
        ? {
            _meta: {
              [OPERATION_ID_META]: receipt.operationId,
              [REPLAYED_META]: receipt.replayed === true,
            },
          }
        : {}),
    };
  } catch (error) {
    return errorResult(entry.meta.mcp.name, error);
  }
}

/**
 * Registers one tool per exposed procedure. `tools/list` shows only those the
 * actor may call (the member's role cut down to the connection's scopes); a
 * call to any of them reaches the procedure, which authorizes it, so a refusal
 * says why (PERMISSION_DENIED) instead of "not found".
 */
export function registerExposedTools(
  server: McpServer,
  ctx: McpRequestContext,
  procedures: readonly ExposedProcedure[],
): void {
  const { role, credential } = ctx.actor;
  for (const entry of procedures) {
    const { name, description, annotations } = entry.meta.mcp;
    addTool(server, {
      name,
      description,
      inputSchema: toolInputSchema(entry),
      annotations,
      listed: allows(role, credential.scopes, entry.meta.scope),
      call: (args) => callProcedure(entry, ctx, args),
    });
  }
}

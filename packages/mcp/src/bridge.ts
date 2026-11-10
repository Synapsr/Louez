import { CONFIRMATION_HEADER } from "@louez/api/platform/confirmation";
import type { ExposedProcedure } from "@louez/api/platform/exposure";
import { reportUnexpectedErrors } from "@louez/api/platform/error-reporting";
import { apiError } from "@louez/api/platform/errors";
import { platformErrors } from "@louez/api/platform/errors";
import { mcpToolAnnotations } from "@louez/api/platform/meta";
import { IDEMPOTENCY_HEADER, type OperationReceipt } from "@louez/api/platform/operations";
import { STORE_HEADER } from "@louez/api/platform/procedures";
import type { CallToolResult, McpServer, Tool } from "@modelcontextprotocol/server";
import { call } from "@orpc/server";

import { isAccountToolListed, isListed, isWithheld, type McpRequestContext } from "./auth/context";
import { addTool } from "./tool-registry";
import { errorResult } from "./utils/errors";
import { handoffLine, linksLine, outputLinks } from "./utils/links";

/** `_meta` keys of a tool result. */
export const OPERATION_ID_META = "io.louez/operationId";
export const REPLAYED_META = "io.louez/replayed";

/** Tool `_meta` key marking the account's profile tool, for ChatGPT. */
export const OPENAI_PROFILE_META = "openai/profile";

/** The `storeId` argument every store tool takes when the connection covers several stores. */
export const STORE_ARGUMENT = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description:
    "The store to act on: an id from stores_list, or the one stores_create returned. Required when this connection covers several stores.",
} as const;

/** The `confirmationToken` argument of a sensitive tool, mapped onto `Louez-Confirmation`. */
export const CONFIRMATION_ARGUMENT = {
  type: "string",
  description:
    "Leave it out on the first call: the tool answers CONFIRMATION_REQUIRED with a preview and this token. After the user confirms, call again with the same arguments and the token.",
} as const;

/**
 * The arguments of a tool: the procedure's input, plus the headers it maps.
 * Only listed: the procedure validates the input, as it does for RPC and
 * OpenAPI, so every transport answers a bad input with the same error.
 */
function toolInputSchema(entry: ExposedProcedure, ctx: McpRequestContext): Tool["inputSchema"] {
  const properties = { ...(entry.inputJsonSchema.properties as Record<string, unknown>) };
  if (ctx.storeArgument && !entry.meta.account) properties.storeId = STORE_ARGUMENT;
  if (entry.meta.scope?.level === "write" && !entry.meta.secretOutput) {
    properties.idempotencyKey = {
      type: "string",
      minLength: 1,
      maxLength: 100,
      description:
        "Optional. A unique string for this action, such as a UUID. Retrying with the same key and the same arguments returns the first result instead of acting twice.",
    };
  }
  if (entry.meta.sensitive) properties.confirmationToken = CONFIRMATION_ARGUMENT;
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
  // The store was read from `storeId` when the request came in.
  const { idempotencyKey, confirmationToken, storeId: _store, ...input } = args;
  const needsStore = !entry.meta.account;
  if (needsStore && ctx.storeError) return errorResult(entry.meta.mcp.name, ctx.storeError);
  if (needsStore && !ctx.storeChosen) {
    return errorResult(entry.meta.mcp.name, platformErrors.storeRequired());
  }
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
  const authorization = ctx.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  if (needsStore) headers.set(STORE_HEADER, ctx.storeId);
  if (typeof idempotencyKey === "string") headers.set(IDEMPOTENCY_HEADER, idempotencyKey);
  if (typeof confirmationToken === "string") headers.set(CONFIRMATION_HEADER, confirmationToken);

  const receipt: OperationReceipt = {};
  try {
    const output = await call(entry.procedure, input, {
      context: { headers, transport: "mcp", ports: ctx.ports, receipt },
      path: entry.path.split("."),
      interceptors: [reportUnexpectedErrors],
    });
    // How an agent sees it (a page of a long list), after a run or a replay alike.
    const whole = jsonSafe(output);
    const structuredContent = entry.meta.mcp.answer ? entry.meta.mcp.answer(whole) : whole;
    const status = receipt.replayed ? "Done earlier (replayed)." : "Done.";
    const operation = receipt.operationId ? ` Operation ${receipt.operationId}.` : "";
    // A record's links on their own line, so a model hands them on as they are.
    const links = outputLinks(structuredContent);
    const handoff = handoffLine(structuredContent);
    const linkLine = `${handoff ? `\n${handoff}` : ""}${links ? `\n${linksLine(links)}` : ""}`;
    // The JSON goes once to a client whose model reads the structured content
    // (ChatGPT); the others get it in the text too, which every client reads.
    const json = ctx.actor.credential.structuredContentOnly
      ? ""
      : `\n${JSON.stringify(structuredContent)}`;
    return {
      content: [{ type: "text", text: `${status}${operation}${linkLine}${json}` }],
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
 * Registers one tool per exposed procedure. `tools/list` shows only those of
 * the connection's bundles that the actor may call (the member's role cut
 * down to the connection's scopes), and none the client's directory forbids
 * (`isWithheld`); a call to any of them reaches the procedure, which
 * authorizes it, so a refusal says why (PERMISSION_DENIED,
 * NOT_AVAILABLE_TO_THIS_AGENT) instead of "not found".
 */
export function registerExposedTools(
  server: McpServer,
  ctx: McpRequestContext,
  procedures: readonly ExposedProcedure[],
): void {
  for (const entry of procedures) {
    const { name, title, description, bundle } = entry.meta.mcp;
    const annotations = mcpToolAnnotations({
      level: entry.meta.scope?.level,
      effect: entry.meta.mcp.effect,
      reach: entry.meta.mcp.reach,
      idempotentHint: entry.meta.mcp.annotations?.idempotentHint,
    });
    const outputSchema = entry.outputJsonSchema as Tool["outputSchema"];
    addTool(server, ctx, {
      name,
      title,
      description,
      inputSchema: toolInputSchema(entry, ctx),
      outputSchema,
      annotations,
      ...(entry.meta.mcp.profile ? { meta: { [OPENAI_PROFILE_META]: true } } : {}),
      listed:
        !isWithheld(ctx, entry.meta.capability) &&
        (entry.meta.account
          ? isAccountToolListed(ctx, entry.meta.scope)
          : entry.meta.scope !== undefined && isListed(ctx, entry.meta.scope, bundle)),
      call: (args) => callProcedure(entry, ctx, args),
    });
  }
}

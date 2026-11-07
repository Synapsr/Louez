import { CONFIRMATION_HEADER } from "@louez/api/platform/confirmation";
import type { ExposedProcedure } from "@louez/api/platform/exposure";
import { apiError } from "@louez/api/platform/errors";
import { platformErrors } from "@louez/api/platform/errors";
import { IDEMPOTENCY_HEADER, type OperationReceipt } from "@louez/api/platform/operations";
import { STORE_HEADER } from "@louez/api/platform/procedures";
import type { CallToolResult, McpServer, Tool } from "@modelcontextprotocol/server";
import { call } from "@orpc/server";

import { isListed, type McpRequestContext } from "./auth/context";
import { addTool } from "./tool-registry";
import { errorResult } from "./utils/errors";

/** `_meta` keys of a tool result. */
export const OPERATION_ID_META = "io.louez/operationId";
export const REPLAYED_META = "io.louez/replayed";

/** The `storeId` argument every store tool takes when the connection covers several stores. */
export const STORE_ARGUMENT = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description:
    "The store to act on: an id from stores_list. Required, as this connection covers several stores.",
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
  if (ctx.multiStore && entry.meta.scope) properties.storeId = STORE_ARGUMENT;
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
  paging?: LegacyPage,
): Promise<CallToolResult> {
  // The store was read from `storeId` when the request came in.
  const { idempotencyKey, confirmationToken, storeId: _store, ...input } = args;
  const needsStore = entry.meta.scope !== undefined;
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
  const run = (procedureInput: Record<string, unknown>) =>
    call(entry.procedure, procedureInput, {
      context: { headers, transport: "mcp", ports: ctx.ports, receipt },
      path: entry.path.split("."),
    });
  try {
    const output = paging ? await runPage(run, input, paging) : await run(input);
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

/** A page of a former tool's offset paging (`aliases[].paging`), as rows to skip and to return. */
interface LegacyPage {
  skip: number;
  size: number;
  /** Most rows one call returns, as the procedure caps its `limit`. */
  step: number;
}

type CursorPage = { items: unknown[]; nextCursor: string | null } & Record<string, unknown>;

/**
 * One offset page through a cursor list: the rows before it are read and
 * dropped, a full step at a time, then the page is read. Each call counts
 * on the rate limit, as the former tool's deep pages cost their offset too.
 */
async function runPage(
  run: (input: Record<string, unknown>) => Promise<unknown>,
  input: Record<string, unknown>,
  page: LegacyPage,
): Promise<CursorPage> {
  let cursor: string | undefined;
  let remaining = page.skip;
  while (remaining > 0) {
    const limit = Math.min(remaining, page.step);
    const skipped = (await run({ ...input, cursor, limit })) as CursorPage;
    if (!skipped.nextCursor) return { ...skipped, items: [], nextCursor: null };
    cursor = skipped.nextCursor;
    remaining -= limit;
  }
  return (await run({ ...input, cursor, limit: page.size })) as CursorPage;
}

/** The page the former arguments ask for, or the error to answer. */
function legacyPage(
  paging: NonNullable<NonNullable<ExposedProcedure["meta"]["mcp"]["aliases"]>[number]["paging"]>,
  args: Record<string, unknown>,
): LegacyPage | Error {
  const page = args[paging.page] ?? 1;
  const size = args[paging.pageSize] ?? paging.defaultPageSize;
  const valid = (value: unknown, max: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
  if (!valid(page, Number.MAX_SAFE_INTEGER) || !valid(size, paging.maxPageSize)) {
    return apiError("BAD_REQUEST", "INVALID_ARGUMENT", {
      message: `${paging.page} is a whole number from 1, ${paging.pageSize} one from 1 to ${paging.maxPageSize}.`,
      details: { arguments: [paging.page, paging.pageSize] },
    });
  }
  return {
    skip: ((page as number) - 1) * (size as number),
    size: size as number,
    step: paging.maxStep,
  };
}

/**
 * Registers one tool per exposed procedure. `tools/list` shows only those of
 * the connection's bundles that the actor may call (the member's role cut
 * down to the connection's scopes); a call to any of them reaches the
 * procedure, which authorizes it, so a refusal says why (PERMISSION_DENIED)
 * instead of "not found".
 */
export function registerExposedTools(
  server: McpServer,
  ctx: McpRequestContext,
  procedures: readonly ExposedProcedure[],
): void {
  for (const entry of procedures) {
    const { name, description, annotations, bundle } = entry.meta.mcp;
    addTool(server, {
      name,
      description,
      inputSchema: toolInputSchema(entry, ctx),
      annotations,
      listed: isListed(ctx, entry.meta.scope, bundle),
      call: (args) => callProcedure(entry, ctx, args),
    });

    // Former names: callable, never listed, the old argument names mapped on
    // and the arguments the old tool implied set.
    for (const alias of entry.meta.mcp.aliases ?? []) {
      const renamed = Object.entries(alias.renamedArgs ?? {});
      const fixed = alias.fixedArgs ?? {};
      addTool(server, {
        name: alias.name,
        description: `Former name of ${name}, kept for agents set up before. ${description}`,
        inputSchema: aliasInputSchema(
          toolInputSchema(entry, ctx),
          renamed,
          Object.keys(fixed),
          alias.paging,
        ),
        annotations,
        listed: false,
        call: (args) => {
          const mapped = { ...args };
          for (const [from, to] of renamed) {
            if (from in mapped) {
              mapped[to] = mapped[from];
              delete mapped[from];
            }
          }
          if (!alias.paging) return callProcedure(entry, ctx, { ...mapped, ...fixed });
          const page = legacyPage(alias.paging, mapped);
          if (page instanceof Error) return Promise.resolve(errorResult(alias.name, page));
          delete mapped[alias.paging.page];
          delete mapped[alias.paging.pageSize];
          return callProcedure(entry, ctx, { ...mapped, ...fixed }, page);
        },
      });
    }
  }
}

/**
 * The tool's input schema with the new argument names put back to the old
 * ones, without the arguments the alias sets itself.
 */
function aliasInputSchema(
  schema: Tool["inputSchema"],
  renamed: ReadonlyArray<[from: string, to: string]>,
  fixed: readonly string[],
  paging?: { page: string; pageSize: string; defaultPageSize: number; maxPageSize: number },
): Tool["inputSchema"] {
  const properties: Record<string, unknown> = { ...schema.properties };
  if (paging) {
    // The former offset paging stands for the cursor.
    delete properties.cursor;
    delete properties.limit;
    properties[paging.page] = {
      type: "integer",
      minimum: 1,
      description: "Page number (default 1)",
    };
    properties[paging.pageSize] = {
      type: "integer",
      minimum: 1,
      maximum: paging.maxPageSize,
      description: `Results per page (default ${paging.defaultPageSize}, max ${paging.maxPageSize})`,
    };
  }
  let required = schema.required ? [...schema.required] : undefined;
  for (const field of fixed) {
    delete properties[field];
    required = required?.filter((name) => name !== field);
  }
  for (const [from, to] of renamed) {
    if (to in properties) {
      properties[from] = properties[to];
      delete properties[to];
    }
    required = required?.map((field) => (field === to ? from : field));
  }
  return {
    ...schema,
    properties: properties as NonNullable<Tool["inputSchema"]["properties"]>,
    ...(required ? { required } : {}),
  };
}

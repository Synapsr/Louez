import { z } from "zod";

import type { Transport } from "./actor";
import { apiError } from "./errors";

/**
 * Pages of a list a procedure reads whole, and whose length grows with the
 * store (a product's units, the reservations of a window, a unit's history).
 *
 * An MCP client caps what a tool may answer (Claude: about 150,000
 * characters; Claude Code: 25,000 tokens) and cuts the rest, so an agent gets
 * `ANSWER_PAGE_MCP_DEFAULT` items and a cursor to read on. The dashboard and
 * the OpenAPI clients get every item, in the service's order, unless they
 * send a `limit` or a `cursor`, as before.
 *
 * A page follows an explicit total order: each list gives every item a key
 * (`PageOrder`), its ordering fields then its id, so no two items share one.
 * The cursor holds the last key read, and the next page starts after that key,
 * wherever the list moved since: an item added, removed or reordered never
 * makes a page skip the items after it. An item whose own key changed between
 * two pages may show twice or not at all, as in any keyset paging.
 */

/** Items an MCP answer carries when the caller sends no limit. */
export const ANSWER_PAGE_MCP_DEFAULT = 100;
/** Largest page a caller may ask for. */
export const ANSWER_PAGE_MAX = 500;

/** The `cursor` and `limit` arguments of a paged answer. */
export const answerPageInput = {
  cursor: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe("The nextCursor of the previous page, to read on. Without it, the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ANSWER_PAGE_MAX)
    .optional()
    .describe(
      `Items per page, at most ${ANSWER_PAGE_MAX}. Without it, a page holds ${ANSWER_PAGE_MCP_DEFAULT} over MCP and every item over the REST API.`,
    ),
};

export interface AnswerPageRequest {
  cursor?: string;
  limit?: number;
}

/**
 * How a list is ordered for paging: a key per item, compared as strings
 * (code units), that ends with the item's unique id. Dates go first as ISO
 * strings, which compare in time order.
 */
export interface PageOrder<T> {
  key: (item: T) => string;
  /** Newest first, for a key that starts with a date. */
  descending?: boolean;
}

const encodeCursor = (key: string) => Buffer.from(key, "utf8").toString("base64url");

function decodeCursor(cursor: string, tool: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalidAnswerCursor(tool);
  const key = Buffer.from(cursor, "base64url").toString("utf8");
  if (key.length === 0 || encodeCursor(key) !== cursor) throw invalidAnswerCursor(tool);
  return key;
}

/** One page of `items` in `order`, and the cursor of the next one (null on the last). */
export function answerPage<T>(
  items: readonly T[],
  order: PageOrder<T>,
  request: AnswerPageRequest,
  context: { transport: Transport; tool: string },
): { items: T[]; nextCursor: string | null } {
  const paged =
    request.cursor !== undefined || request.limit !== undefined || context.transport === "mcp";
  if (!paged) return { items: [...items], nextCursor: null };

  const sign = order.descending ? -1 : 1;
  const compare = (a: string, b: string) => sign * (a < b ? -1 : a > b ? 1 : 0);
  const keyed = items
    .map((item) => ({ item, key: order.key(item) }))
    .sort((a, b) => compare(a.key, b.key));
  const after = request.cursor === undefined ? null : decodeCursor(request.cursor, context.tool);
  const rest = after === null ? keyed : keyed.filter((entry) => compare(entry.key, after) > 0);
  const limit =
    request.limit ??
    (context.transport === "mcp" ? ANSWER_PAGE_MCP_DEFAULT : Number.POSITIVE_INFINITY);
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((entry) => entry.item),
    nextCursor: rest.length > page.length && last ? encodeCursor(last.key) : null,
  };
}

const invalidAnswerCursor = (tool: string) =>
  apiError("BAD_REQUEST", "INVALID_CURSOR", {
    message: `This cursor is not one ${tool} returned. Start again without a cursor.`,
    i18nKey: "errors.invalidData",
    details: { tool },
  });

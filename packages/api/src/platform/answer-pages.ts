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
 * the OpenAPI clients get every item unless they send a `limit`, as before.
 * The cursor is the key of the last item read: an item added before it never
 * makes the next page skip one, and a cursor whose item left the list is
 * refused (INVALID_CURSOR), so the caller starts again.
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
    .max(200)
    .optional()
    .describe("The nextCursor of the previous page, to read on. Without it, the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ANSWER_PAGE_MAX)
    .optional()
    .describe(
      `Items per page, at most ${ANSWER_PAGE_MAX}. Without it, an agent (MCP) gets ${ANSWER_PAGE_MCP_DEFAULT}, the API every item.`,
    ),
};

export interface AnswerPageRequest {
  cursor?: string;
  limit?: number;
}

/** One page of `items`, in their order, and the cursor of the next one (null on the last). */
export function answerPage<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  request: AnswerPageRequest,
  context: { transport: Transport; tool: string },
): { items: T[]; nextCursor: string | null } {
  let start = 0;
  if (request.cursor !== undefined) {
    const at = items.findIndex((item) => keyOf(item) === request.cursor);
    if (at < 0) throw invalidAnswerCursor(context.tool);
    start = at + 1;
  }
  const limit =
    request.limit ??
    (context.transport === "mcp" ? ANSWER_PAGE_MCP_DEFAULT : Number.POSITIVE_INFINITY);
  const page = items.slice(start, start + limit);
  const last = page.at(-1);
  const more = start + page.length < items.length;
  return { items: page, nextCursor: more && last !== undefined ? keyOf(last) : null };
}

const invalidAnswerCursor = (tool: string) =>
  apiError("BAD_REQUEST", "INVALID_CURSOR", {
    message: `This cursor is not one ${tool} returned, or its item is gone. Start again without a cursor.`,
    i18nKey: "errors.invalidData",
    details: { tool },
  });

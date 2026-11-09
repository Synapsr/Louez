import assert from "node:assert/strict";
import { test } from "node:test";

import { ANSWER_PAGE_MCP_DEFAULT, answerPage } from "./answer-pages";

const items = Array.from({ length: 250 }, (_, index) => ({ id: `item_${index}` }));
const key = (item: { id: string }) => item.id;

test("an agent gets a first page and reads every item once with the cursors", () => {
  const mcp = { transport: "mcp" as const, tool: "test_tool" };
  const first = answerPage(items, key, {}, mcp);
  assert.equal(first.items.length, ANSWER_PAGE_MCP_DEFAULT);
  assert.equal(first.nextCursor, `item_${ANSWER_PAGE_MCP_DEFAULT - 1}`);

  const read = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = answerPage(items, key, { cursor }, mcp);
    read.push(...page.items);
    cursor = page.nextCursor;
  }
  assert.deepEqual(read, items);

  // An item added before the cursor never makes the next page skip one.
  const grown = [{ id: "item_new" }, ...items];
  assert.deepEqual(answerPage(grown, key, { cursor: "item_99", limit: 1 }, mcp).items, [
    { id: "item_100" },
  ]);
});

test("the dashboard and the API get every item unless they ask for a page", () => {
  for (const transport of ["rpc", "openapi"] as const) {
    const whole = answerPage(items, key, {}, { transport, tool: "test_tool" });
    assert.equal(whole.items.length, 250);
    assert.equal(whole.nextCursor, null);
    const page = answerPage(items, key, { limit: 10 }, { transport, tool: "test_tool" });
    assert.equal(page.items.length, 10);
    assert.equal(page.nextCursor, "item_9");
  }
});

test("a cursor whose item is gone is refused", () => {
  assert.throws(
    () => answerPage(items, key, { cursor: "missing" }, { transport: "mcp", tool: "test_tool" }),
    (error: { data?: { code?: string } }) => error.data?.code === "INVALID_CURSOR",
  );
  assert.deepEqual(answerPage([], key, {}, { transport: "mcp", tool: "test_tool" }), {
    items: [],
    nextCursor: null,
  });
});

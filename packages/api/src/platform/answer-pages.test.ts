import assert from "node:assert/strict";
import { test } from "node:test";

import { ANSWER_PAGE_MCP_DEFAULT, answerPage, type PageOrder } from "./answer-pages";

interface Entry {
  id: string;
  startDate: string;
}
const byStart: PageOrder<Entry> = { key: (entry) => `${entry.startDate}\u0000${entry.id}` };
const mcp = { transport: "mcp" as const, tool: "test_tool" };

const items: Entry[] = Array.from({ length: 250 }, (_, index) => ({
  id: `item_${String(index).padStart(3, "0")}`,
  startDate: "2030-06-01T09:00:00.000Z",
}));

test("an agent gets a first page and reads every item once with the cursors", () => {
  const first = answerPage(items, byStart, {}, mcp);
  assert.equal(first.items.length, ANSWER_PAGE_MCP_DEFAULT);
  const read = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = answerPage(items, byStart, { cursor }, mcp);
    read.push(...page.items);
    cursor = page.nextCursor;
  }
  assert.deepEqual(read, items);
});

test("a page after one whose items moved or left reads on from its key", () => {
  const a = { id: "a", startDate: "2030-06-01T09:00:00.000Z" };
  const b = { id: "b", startDate: "2030-06-02T09:00:00.000Z" };
  const c = { id: "c", startDate: "2030-06-03T09:00:00.000Z" };
  const first = answerPage([a, b, c], byStart, { limit: 1 }, mcp);
  assert.deepEqual(first.items, [a]);
  // Codex's case: A's lines changed, and the service now returns it last.
  const moved = answerPage([b, c, a], byStart, { limit: 10, cursor: first.nextCursor! }, mcp);
  assert.deepEqual(moved.items, [b, c]);
  assert.equal(moved.nextCursor, null);
  // A left the list: the page after it is still B and C.
  const gone = answerPage([b, c], byStart, { limit: 10, cursor: first.nextCursor! }, mcp);
  assert.deepEqual(gone.items, [b, c]);
  // An item added before the cursor is not read again, one after it is.
  const early = { id: "0", startDate: "2030-05-01T09:00:00.000Z" };
  const late = { id: "d", startDate: "2030-06-04T09:00:00.000Z" };
  assert.deepEqual(
    answerPage([early, a, b, c, late], byStart, { cursor: first.nextCursor! }, mcp).items,
    [b, c, late],
  );
});

test("a newest-first list pages in that order", () => {
  const newestFirst: PageOrder<Entry> = { ...byStart, descending: true };
  const list = [
    { id: "old", startDate: "2030-01-01T00:00:00.000Z" },
    { id: "new", startDate: "2030-03-01T00:00:00.000Z" },
    { id: "mid", startDate: "2030-02-01T00:00:00.000Z" },
  ];
  const first = answerPage(list, newestFirst, { limit: 2 }, mcp);
  assert.deepEqual(
    first.items.map((entry) => entry.id),
    ["new", "mid"],
  );
  assert.deepEqual(
    answerPage(list, newestFirst, { cursor: first.nextCursor! }, mcp).items.map(
      (entry) => entry.id,
    ),
    ["old"],
  );
});

test("the dashboard and the API get every item in the service's order unless they ask for a page", () => {
  const shuffled = [...items].reverse();
  for (const transport of ["rpc", "openapi"] as const) {
    const whole = answerPage(shuffled, byStart, {}, { transport, tool: "test_tool" });
    assert.deepEqual(whole.items, shuffled);
    assert.equal(whole.nextCursor, null);
    const page = answerPage(shuffled, byStart, { limit: 10 }, { transport, tool: "test_tool" });
    assert.deepEqual(page.items, items.slice(0, 10));
    // A cursor alone reads on to the end.
    const rest = answerPage(shuffled, byStart, { cursor: page.nextCursor! }, { transport, tool: "x" });
    assert.equal(rest.items.length, 240);
  }
});

test("a cursor that is not one the tool gave is refused", () => {
  for (const cursor of ["not a cursor", "%%%", "QQ=="]) {
    assert.throws(
      () => answerPage(items, byStart, { cursor }, mcp),
      (error: { data?: { code?: string } }) => error.data?.code === "INVALID_CURSOR",
      cursor,
    );
  }
  assert.deepEqual(answerPage([], byStart, {}, mcp), { items: [], nextCursor: null });
});

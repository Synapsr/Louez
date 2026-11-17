import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { listInboxInput } from "./inbox";

// `types` comes as an array over RPC and MCP, and from a query string as a
// string when it holds one value (`?types=a`), an array when several.

describe("the inbox's types filter", () => {
  test("one type from a query string reads as a list of one", () => {
    assert.deepEqual(listInboxInput.parse({ types: "refund_undone" }).types, ["refund_undone"]);
  });

  test("several types read as they come; none leaves the filter out", () => {
    assert.deepEqual(listInboxInput.parse({ types: ["refund_undone", "message_not_sent"] }).types, [
      "refund_undone",
      "message_not_sent",
    ]);
    assert.equal(listInboxInput.parse({}).types, undefined);
  });

  test("a value that is not a type, or an empty list, is refused", () => {
    assert.equal(listInboxInput.safeParse({ types: "not_a_type" }).success, false);
    assert.equal(listInboxInput.safeParse({ types: ["refund_undone", "nope"] }).success, false);
    assert.equal(listInboxInput.safeParse({ types: [] }).success, false);
  });
});

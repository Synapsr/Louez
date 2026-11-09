import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { truncateText } from "./util.seo-text";

describe("truncateText", () => {
  it("leaves short text alone", () => {
    assert.equal(truncateText("court", 160), "court");
  });

  it("cuts to the limit with an ellipsis", () => {
    const text = truncateText("a".repeat(200), 160);
    assert.equal(text.length, 160);
    assert.ok(text.endsWith("..."));
  });
});

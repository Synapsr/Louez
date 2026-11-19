import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { encodePartnerCookie, partnerCodeFromCookie } from "./partner-cookie";

describe("partner cookie", () => {
  test("reads back the code it wrote, for the same store only", () => {
    const value = encodePartnerCookie("store_a", "camping-les-pins");
    assert.equal(partnerCodeFromCookie(value, "store_a"), "camping-les-pins");
    assert.equal(partnerCodeFromCookie(value, "store_b"), null);
  });

  test("refuses a missing, malformed or forged value", () => {
    assert.equal(partnerCodeFromCookie(undefined, "store_a"), null);
    assert.equal(partnerCodeFromCookie("camping-les-pins", "store_a"), null);
    assert.equal(partnerCodeFromCookie("store_a.", "store_a"), null);
    assert.equal(partnerCodeFromCookie("store_a.<script>", "store_a"), null);
  });
});

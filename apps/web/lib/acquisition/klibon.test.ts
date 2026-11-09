import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAffiliateReferral } from "./klibon";

test("an affiliate code with Klibon's shape is kept", () => {
  assert.equal(parseAffiliateReferral("aff_42"), "aff_42");
  assert.equal(parseAffiliateReferral("A-b_9"), "A-b_9");
  assert.equal(parseAffiliateReferral("x".repeat(64)), "x".repeat(64));
});

test("anything else is dropped, as for a visitor no affiliate sent", () => {
  for (const value of [null, undefined, "", "x".repeat(65), "a b", "a;drop", "é", 42, {}]) {
    assert.equal(parseAffiliateReferral(value), undefined, String(value));
  }
});

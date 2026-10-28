import assert from "node:assert/strict";
import { test } from "node:test";

import { stripeKeyMode } from "./client";

test("a key's mode comes from its prefix, and any other prefix counts as live", () => {
  assert.equal(stripeKeyMode("sk_test_1"), "test");
  assert.equal(stripeKeyMode("rk_test_1"), "test");
  assert.equal(stripeKeyMode("sk_live_1"), "live");
  assert.equal(stripeKeyMode("rk_live_1"), "live");
  assert.equal(stripeKeyMode(""), "live");
});

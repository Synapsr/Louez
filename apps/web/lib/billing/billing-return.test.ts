import assert from "node:assert/strict";
import { test } from "node:test";

import { readBillingReturnOutcome, withBillingReturnOutcome } from "./billing-return";

// The toast of the owner's return from Stripe Checkout (louez-billing docs/api, README
// §10 step 5).

test("the toast travels only as one of its two outcomes", () => {
  assert.equal(
    withBillingReturnOutcome("/onboarding/source", "refreshed"),
    "/onboarding/source?billing=refreshed",
  );
  assert.equal(readBillingReturnOutcome("refreshed"), "refreshed");
  assert.equal(readBillingReturnOutcome("pending"), "pending");
  for (const value of [null, "", "done", "REFRESHED"]) {
    assert.equal(readBillingReturnOutcome(value), null, String(value));
  }
});

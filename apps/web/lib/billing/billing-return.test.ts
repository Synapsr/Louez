import assert from "node:assert/strict";
import { test } from "node:test";

import {
  billingReturnOriginPath,
  billingReturnTarget,
  readBillingReturnOutcome,
  withBillingReturnOutcome,
} from "./billing-return";

// Where "Back to Louez" lands (louez-billing docs/api, README §10 step 4): the billing
// settings, or the onboarding's card step when the hand-off left from it.

test("the return lands on the settings, or on the onboarding's card step", () => {
  assert.equal(billingReturnOriginPath(null), "/dashboard/settings/billing");
  assert.equal(billingReturnOriginPath("onboarding"), "/onboarding/billing");
  assert.equal(billingReturnTarget("refreshed"), "/dashboard/settings/billing?billing=refreshed");
  assert.equal(billingReturnTarget("pending", "onboarding"), "/onboarding/billing?billing=pending");
});

test("the toast travels to the next step only as one of its two outcomes", () => {
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

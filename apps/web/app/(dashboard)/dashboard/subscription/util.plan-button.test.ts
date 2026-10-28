import assert from "node:assert/strict";
import { test } from "node:test";

import { planButtonAction } from "./util.plan-button";

// A store pays one plan subscription at a time (plans-for-new-stores decision 5).

const buyable = { isFree: false, isAvailable: true, isExactCurrentPlan: false };

test("without a live subscription, a plan button opens a Checkout", () => {
  assert.equal(planButtonAction({ ...buyable, hasLiveSubscription: false }), "checkout");
});

test("with a live subscription, every other plan or interval changes it in place", () => {
  assert.equal(planButtonAction({ ...buyable, hasLiveSubscription: true }), "change");
});

test("the exact current plan, a plan without a price or the free one does nothing", () => {
  for (const hasLiveSubscription of [false, true]) {
    for (const blocked of [
      { isExactCurrentPlan: true },
      { isAvailable: false },
      { isFree: true },
    ]) {
      assert.equal(
        planButtonAction({ ...buyable, ...blocked, hasLiveSubscription }),
        "none",
        JSON.stringify(blocked),
      );
    }
  }
});

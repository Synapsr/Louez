import assert from "node:assert/strict";
import { test } from "node:test";

import { type PlanRow, planInForce, planInForceSlug, storePlanOfRow } from "./plan-limits";

// When a Louez plan is in force on a store's row (louez-billing docs/api, README §8.7):
// the rule the store snapshot sends, beside the plan getStorePlan gives.

const PRO_IN_FORCE: PlanRow = {
  billingMode: "subscription",
  planSlug: "pro",
  status: "active",
  stripeSubscriptionId: "sub_test",
};

test("no plan is in force without a row, on pay-as-you-go or once cancelled", () => {
  assert.equal(planInForce(null), false);
  assert.equal(planInForce(undefined), false);
  assert.equal(planInForce({ ...PRO_IN_FORCE, billingMode: "pay_as_you_go" }), false);
  assert.equal(planInForce({ ...PRO_IN_FORCE, status: "cancelled" }), false);
});

test("no plan is in force with a slug Louez does not know or no Stripe subscription", () => {
  for (const planSlug of ["pay_as_you_go", "start", "enterprise"]) {
    assert.equal(planInForce({ ...PRO_IN_FORCE, planSlug }), false, planSlug);
  }
  assert.equal(planInForce({ ...PRO_IN_FORCE, stripeSubscriptionId: null }), false);
  assert.equal(planInForce({ ...PRO_IN_FORCE, stripeSubscriptionId: "" }), false);
});

test("a plan is in force while active, trialing or past due", () => {
  for (const planSlug of ["pro", "ultra"]) {
    for (const status of ["active", "trialing", "past_due"] as const) {
      assert.equal(
        planInForce({ ...PRO_IN_FORCE, planSlug, status }),
        true,
        `${planSlug} ${status}`,
      );
    }
  }
});

test("on every row with a Stripe subscription id, it agrees with getStorePlan", () => {
  for (const billingMode of ["subscription", "pay_as_you_go"] as const) {
    for (const status of ["active", "trialing", "past_due", "cancelled"] as const) {
      for (const planSlug of ["pro", "ultra", "pay_as_you_go", "start"]) {
        const row: PlanRow = { billingMode, planSlug, status, stripeSubscriptionId: "sub_test" };
        const paidPlan = storePlanOfRow(row).slug !== "pay_as_you_go";
        assert.equal(planInForce(row), paidPlan, `${billingMode} ${status} ${planSlug}`);
      }
    }
  }
  // Without one, an admin's subscription billing gives the plan's limits, not a plan in force.
  const adminSet = { ...PRO_IN_FORCE, stripeSubscriptionId: null };
  assert.equal(storePlanOfRow(adminSet).slug, "pro");
  assert.equal(planInForce(adminSet), false);
});

test("the plan in force is its slug, or null: a status that keeps it in force does not change it", () => {
  assert.equal(planInForceSlug(PRO_IN_FORCE), "pro");
  assert.equal(planInForceSlug({ ...PRO_IN_FORCE, status: "past_due" }), "pro");
  assert.equal(planInForceSlug({ ...PRO_IN_FORCE, planSlug: "ultra" }), "ultra");
  assert.equal(planInForceSlug({ ...PRO_IN_FORCE, status: "cancelled" }), null);
  assert.equal(planInForceSlug({ ...PRO_IN_FORCE, stripeSubscriptionId: null }), null);
  assert.equal(planInForceSlug(undefined), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { canConfirmPlanChange, planChangePreviewView } from "./util.plan-change-preview";

// The plan change dialog shows what Stripe's preview answers, and the owner confirms only
// once it has answered.

test("the dialog loads until the preview answers, and shows each answer", () => {
  const at = new Date("2026-11-28T10:00:00Z");
  const cases = [
    [{ data: undefined, isError: false }, { status: "loading" }],
    [
      { data: { kind: "now", amountDue: 4900, currency: "eur" }, isError: false },
      { status: "now", amountDue: 4900, currency: "eur" },
    ],
    [{ data: { kind: "at_period_end", at }, isError: false }, { status: "at_period_end", at }],
    [{ data: { kind: "checkout" }, isError: false }, { status: "checkout" }],
  ] as const;
  for (const [query, view] of cases) assert.deepEqual(planChangePreviewView(query), view);
});

test("a refused preview shows its error; one that throws shows the generic error", () => {
  assert.deepEqual(
    planChangePreviewView({ data: { error: "errors.unsupportedOperation" }, isError: false }),
    { status: "error", error: "errors.unsupportedOperation" },
  );
  assert.deepEqual(planChangePreviewView({ data: undefined, isError: true }), {
    status: "error",
    error: "errors.generic",
  });
});

test("the change is confirmed only once the dialog says what it does", () => {
  assert.equal(canConfirmPlanChange({ status: "loading" }), false);
  assert.equal(canConfirmPlanChange({ status: "error", error: "errors.generic" }), false);
  assert.equal(canConfirmPlanChange({ status: "now", amountDue: 0, currency: "eur" }), true);
  assert.equal(canConfirmPlanChange({ status: "at_period_end", at: new Date() }), true);
  assert.equal(canConfirmPlanChange({ status: "checkout" }), true);
});

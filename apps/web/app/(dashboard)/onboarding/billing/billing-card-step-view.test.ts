import assert from "node:assert/strict";
import { test } from "node:test";

import { billingCardStepView } from "./billing-card-step-view";

// What the onboarding's "Billing card" page answers (M2 plan L6): the step and its
// link, or the next step with the toast of the return from the billing pages.

test("the step's button opens the card page through the hand-off, and comes back here", () => {
  for (const billing of [null, "pending", "junk"]) {
    assert.deepEqual(
      billingCardStepView({ shown: true, needsSource: true, billing }),
      { kind: "show", cardHref: "/dashboard/billing?to=%2Fpayment-method&from=onboarding" },
      String(billing),
    );
  }
});

test("a step that no longer applies goes on to the next one, with the return's toast", () => {
  assert.deepEqual(billingCardStepView({ shown: false, needsSource: true, billing: "refreshed" }), {
    kind: "redirect",
    to: "/onboarding/source?billing=refreshed",
  });
  assert.deepEqual(billingCardStepView({ shown: false, needsSource: false, billing: "pending" }), {
    kind: "redirect",
    to: "/dashboard?billing=pending",
  });
});

test("without a toast, or with one Louez does not know, the next step gets none", () => {
  for (const billing of [null, "", "done"]) {
    assert.deepEqual(
      billingCardStepView({ shown: false, needsSource: true, billing }),
      { kind: "redirect", to: "/onboarding/source" },
      String(billing),
    );
    assert.deepEqual(
      billingCardStepView({ shown: false, needsSource: false, billing }),
      { kind: "redirect", to: "/dashboard" },
      String(billing),
    );
  }
});

test("back with the card step still due, the toast says the change can take a while, not up to date", () => {
  assert.deepEqual(billingCardStepView({ shown: true, needsSource: true, billing: "refreshed" }), {
    kind: "redirect",
    to: "/onboarding/billing?billing=pending",
  });
  // The page it redirects to then shows the step, so there is no loop.
  assert.equal(
    billingCardStepView({ shown: true, needsSource: true, billing: "pending" }).kind,
    "show",
  );
});

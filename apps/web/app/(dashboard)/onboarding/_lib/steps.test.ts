import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeStripeNextPath } from "../../dashboard/settings/payments/stripe-return";
import { getNextOnboardingPath, getOnboardingSteps, getStripeKycReturnPath } from "./steps";

// The onboarding's flow: the conditional steps, and where each step goes next.

const flow = (options: Partial<Parameters<typeof getOnboardingSteps>[0]> = {}) =>
  getOnboardingSteps({
    needsReeentIntro: false,
    needsProfile: false,
    needsBillingCard: false,
    needsSource: false,
    ...options,
  });

test("the billing card step comes right after the payment step, only when the store needs it", () => {
  assert.deepEqual(
    flow().map((step) => step.key),
    ["store", "branding", "payment"],
  );
  assert.deepEqual(
    flow({ needsBillingCard: true, needsSource: true }).map((step) => step.key),
    ["store", "branding", "payment", "billing", "source"],
  );
});

test("the payment step goes to the billing card, then the source step, then the dashboard", () => {
  const all = flow({ needsBillingCard: true, needsSource: true });
  assert.equal(getNextOnboardingPath(all, "/onboarding/stripe"), "/onboarding/billing");
  assert.equal(getNextOnboardingPath(all, "/onboarding/billing"), "/onboarding/source");
  assert.equal(getNextOnboardingPath(all, "/onboarding/source"), "/dashboard");

  assert.equal(
    getNextOnboardingPath(flow({ needsSource: true }), "/onboarding/stripe"),
    "/onboarding/source",
  );
  assert.equal(
    getNextOnboardingPath(flow({ needsBillingCard: true }), "/onboarding/billing"),
    "/dashboard",
  );
  assert.equal(getNextOnboardingPath(flow(), "/onboarding/stripe"), "/dashboard");
});

test("a step outside this flow still goes to the next step of the flow", () => {
  assert.equal(
    getNextOnboardingPath(flow({ needsSource: true }), "/onboarding/billing"),
    "/onboarding/source",
  );
  assert.equal(getNextOnboardingPath(flow(), "/onboarding/billing"), "/dashboard");
});

test("Stripe's KYC comes back to the step after the payment step, or to the settings callback", () => {
  assert.equal(
    getStripeKycReturnPath(flow({ needsBillingCard: true, needsSource: true })),
    "/onboarding/billing",
  );
  assert.equal(getStripeKycReturnPath(flow({ needsBillingCard: true })), "/onboarding/billing");
  assert.equal(getStripeKycReturnPath(flow({ needsSource: true })), "/onboarding/source");
  assert.equal(getStripeKycReturnPath(flow()), null);
});

test("every step the KYC can come back to passes the Stripe return's allowlist", () => {
  for (const needsBillingCard of [true, false]) {
    for (const needsSource of [true, false]) {
      const path = getStripeKycReturnPath(flow({ needsBillingCard, needsSource }));
      if (path) assert.equal(sanitizeStripeNextPath(path), path, path);
    }
  }
});

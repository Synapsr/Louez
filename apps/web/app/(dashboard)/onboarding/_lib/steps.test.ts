import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeStripeNextPath } from "../../dashboard/settings/payments/stripe-return";
import { getNextOnboardingPath, getOnboardingSteps, getStripeKycReturnPath } from "./steps";

// The onboarding's flow: the conditional steps, and where each step goes next.

const flow = (options: Partial<Parameters<typeof getOnboardingSteps>[0]> = {}) =>
  getOnboardingSteps({
    needsReeentIntro: false,
    needsProfile: false,
    needsSource: false,
    ...options,
  });

test("the source step comes after the payment step, only when it is due", () => {
  assert.deepEqual(
    flow().map((step) => step.key),
    ["store", "branding", "payment"],
  );
  assert.deepEqual(
    flow({ needsSource: true }).map((step) => step.key),
    ["store", "branding", "payment", "source"],
  );
});

test("the payment step goes to the source step, then the dashboard", () => {
  const all = flow({ needsSource: true });
  assert.equal(getNextOnboardingPath(all, "/onboarding/stripe"), "/onboarding/source");
  assert.equal(getNextOnboardingPath(all, "/onboarding/source"), "/dashboard");
  assert.equal(getNextOnboardingPath(flow(), "/onboarding/stripe"), "/dashboard");
});

test("a step outside this flow still goes to the next step of the flow", () => {
  assert.equal(
    getNextOnboardingPath(flow({ needsSource: true }), "/onboarding/profile"),
    "/onboarding",
  );
});

test("Stripe's KYC comes back to the step after the payment step, or to the settings callback", () => {
  assert.equal(getStripeKycReturnPath(flow({ needsSource: true })), "/onboarding/source");
  assert.equal(getStripeKycReturnPath(flow()), null);
});

test("every step the KYC can come back to passes the Stripe return's allowlist", () => {
  for (const needsSource of [true, false]) {
    const path = getStripeKycReturnPath(flow({ needsSource }));
    if (path) assert.equal(sanitizeStripeNextPath(path), path, path);
  }
});

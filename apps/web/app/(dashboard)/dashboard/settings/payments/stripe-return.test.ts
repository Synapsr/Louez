import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeStripeNextPath } from "./stripe-return";

// `next` round-trips through Stripe's hosted KYC: only the onboarding steps that can
// follow the payment step are allowed, anything else would be an open redirect.

test("the KYC detour comes back to the source step", () => {
  assert.equal(sanitizeStripeNextPath("/onboarding/source"), "/onboarding/source");
});

test("any other value goes to the settings callback", () => {
  for (const value of [
    undefined,
    null,
    "",
    "/dashboard",
    "/onboarding/source?x=1",
    "https://evil.test/onboarding/source",
    "//evil.test",
    ["/onboarding/source"],
  ]) {
    assert.equal(sanitizeStripeNextPath(value), null, JSON.stringify(value));
  }
});

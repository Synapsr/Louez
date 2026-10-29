import assert from "node:assert/strict";
import { test } from "node:test";

import { isBillingOnlyPath } from "./billing-routes";

// The billing pages' routes (louez-billing docs/api, README §10, §12).

test("the billing settings, their statements and the card step exist only with platform billing", () => {
  for (const path of [
    "/dashboard/settings/billing",
    "/dashboard/settings/billing/statements",
    "/dashboard/settings/billing/statements/2027-02-EUR",
    "/onboarding/billing",
  ]) {
    assert.ok(isBillingOnlyPath(path), path);
  }
  assert.ok(!isBillingOnlyPath("/dashboard/settings/billingx"));
  assert.ok(!isBillingOnlyPath("/onboarding"));
  assert.ok(!isBillingOnlyPath("/onboarding/branding"));
});

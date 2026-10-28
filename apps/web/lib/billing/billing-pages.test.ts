import assert from "node:assert/strict";
import { test } from "node:test";

import { billingPageHref } from "./billing-pages";

test("a billing page opens through Louez's hand-off route (README §10)", () => {
  assert.equal(billingPageHref("/payment-method"), "/dashboard/billing?to=/payment-method");
  assert.equal(billingPageHref("/"), "/dashboard/billing?to=/");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { selectMonthlyBillingStoreIds, summarizeMonthlyPlatformFees } from "./billing-core";

test("monthly billing includes subscription stores with pending marketplace fees", () => {
  assert.deepEqual(selectMonthlyBillingStoreIds(["payg-store"], ["subscription-store"]), [
    "payg-store",
    "subscription-store",
  ]);
});

test("subscription-store invoices contain only the marketplace line", () => {
  const summary = summarizeMonthlyPlatformFees(
    [
      { amountCents: 250, source: "manual", status: "pending" },
      { amountCents: 100, source: "marketplace_manual", status: "pending" },
    ],
    false,
  );

  assert.equal(summary.usageFeeAmountCents, 0);
  assert.equal(summary.usageLocationCount, 0);
  assert.equal(summary.marketplaceFeeAmountCents, 100);
  assert.equal(summary.marketplaceReservationCount, 1);
  assert.equal(summary.invoicedAmountCents, 100);
});

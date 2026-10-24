import assert from "node:assert/strict";
import { test } from "node:test";

import {
  firstUnbilledMonthStart,
  isMonthlyBillingTick,
  selectMonthlyBillingStoreIds,
  summarizeMonthlyPlatformFees,
} from "./billing-core";

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

test("the monthly run ticks on the 1st at 05:00 UTC only", () => {
  assert.equal(isMonthlyBillingTick(new Date("2026-03-01T05:00:00Z")), true);
  assert.equal(isMonthlyBillingTick(new Date("2026-03-01T05:00:59Z")), true);
  assert.equal(isMonthlyBillingTick(new Date("2026-03-01T04:59:00Z")), false);
  assert.equal(isMonthlyBillingTick(new Date("2026-03-01T05:01:00Z")), false);
  assert.equal(isMonthlyBillingTick(new Date("2026-03-02T05:00:00Z")), false);
  // 05:00 in Paris is 04:00 UTC.
  assert.equal(isMonthlyBillingTick(new Date("2026-03-01T05:00:00+01:00")), false);
});

test("the previous month stays unbilled until the run on the 1st", () => {
  assert.deepEqual(
    firstUnbilledMonthStart(new Date("2026-03-01T04:45:00Z")),
    new Date("2026-02-01T00:00:00Z"),
  );
  assert.deepEqual(
    firstUnbilledMonthStart(new Date("2026-03-01T05:00:00Z")),
    new Date("2026-03-01T00:00:00Z"),
  );
  assert.deepEqual(
    firstUnbilledMonthStart(new Date("2026-03-02T04:45:00Z")),
    new Date("2026-03-01T00:00:00Z"),
  );
  assert.deepEqual(
    firstUnbilledMonthStart(new Date("2026-01-01T04:45:00Z")),
    new Date("2025-12-01T00:00:00Z"),
  );
});

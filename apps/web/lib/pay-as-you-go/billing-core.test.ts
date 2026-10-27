import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canBillMonth,
  dueBillingMonth,
  firstUnbilledMonthStart,
  monthlyBillingRunStart,
  parseBillingMonth,
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

test("a billing month is YYYY-MM, and its run starts on the 1st after it at 05:00 UTC", () => {
  assert.deepEqual(parseBillingMonth("2026-11"), new Date("2026-11-01T00:00:00Z"));
  for (const text of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", " 2026-11", ""]) {
    assert.equal(parseBillingMonth(text), null, text);
  }

  assert.deepEqual(monthlyBillingRunStart("2026-11"), new Date("2026-12-01T05:00:00Z"));
  assert.deepEqual(monthlyBillingRunStart("2026-12"), new Date("2027-01-01T05:00:00Z"));
  assert.throws(() => monthlyBillingRunStart("2026-13"), /Not a billing month/);
});

test("a month can be billed from its run on, never the current or a future month", () => {
  const now = new Date("2026-12-15T12:00:00Z");
  assert.equal(canBillMonth("2026-11", now), true);
  assert.equal(canBillMonth("2025-06", now), true);
  assert.equal(canBillMonth("2026-12", now), false);
  assert.equal(canBillMonth("2027-01", now), false);

  // The previous month only from 05:00 UTC on the 1st. 05:00 in Paris is 04:00 UTC.
  assert.equal(canBillMonth("2026-11", new Date("2026-12-01T04:59:59Z")), false);
  assert.equal(canBillMonth("2026-11", new Date("2026-12-01T05:00:00+01:00")), false);
  assert.equal(canBillMonth("2026-11", new Date("2026-12-01T05:00:00Z")), true);
});

test("the due month is the previous one from 05:00 UTC on the 1st until the next run", () => {
  assert.equal(dueBillingMonth(new Date("2026-12-01T04:59:59Z")), "2026-10");
  assert.equal(dueBillingMonth(new Date("2026-12-01T05:00:00Z")), "2026-11");
  assert.equal(dueBillingMonth(new Date("2026-12-03T10:00:00Z")), "2026-11");
  assert.equal(dueBillingMonth(new Date("2026-12-31T23:59:59Z")), "2026-11");
  assert.equal(dueBillingMonth(new Date("2027-01-01T04:59:59Z")), "2026-11");
  assert.equal(dueBillingMonth(new Date("2027-01-01T05:00:00Z")), "2026-12");
  assert.equal(dueBillingMonth(new Date("2027-01-15T00:00:00Z")), "2026-12");

  // Whatever the instant, the due month can be billed then.
  for (const now of ["2026-12-01T05:00:00Z", "2026-12-01T04:59:59Z", "2027-02-28T23:00:00Z"]) {
    assert.equal(canBillMonth(dueBillingMonth(new Date(now)), new Date(now)), true, now);
  }
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

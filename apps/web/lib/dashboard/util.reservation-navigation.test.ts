import assert from "node:assert/strict";
import { test } from "node:test";

import { getDashboardReservationBackHref } from "@/lib/dashboard/util.reservation-navigation";

test("keeps the calendar date, view and filters in the fallback return URL", () => {
  const returnTo = "/dashboard/reservations?view=calendar&date=2026-10-17&range=week#timeline";
  assert.equal(getDashboardReservationBackHref(returnTo), returnTo);
});

test("preserves other dashboard destinations as fallback return URLs", () => {
  assert.equal(
    getDashboardReservationBackHref("/dashboard/customers/customer-1"),
    "/dashboard/customers/customer-1",
  );
});

test("rejects external and non-dashboard fallback return URLs", () => {
  for (const returnTo of [
    undefined,
    "https://example.com",
    "//example.com",
    "/catalog",
    "/dashboard-other",
  ]) {
    assert.equal(getDashboardReservationBackHref(returnTo), "/dashboard/reservations");
  }
});

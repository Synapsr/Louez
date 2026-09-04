import assert from "node:assert/strict";
import { test } from "node:test";

import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import {
  getReservationDetailHref,
  getReservationStatusAnalyticsAction,
  resolveReservationAnalyticsSource,
} from "@/lib/product-analytics/reservation-analytics";

test("keeps known reservation entry sources and rejects arbitrary query values", () => {
  assert.equal(resolveReservationAnalyticsSource({ explicitSource: "home_return" }), "home_return");
  assert.equal(
    resolveReservationAnalyticsSource({
      explicitSource: "customer-email@example.com",
      referrerPathname: "/dashboard",
    }),
    "dashboard_home",
  );
});

test("infers a coarse source from the previous dashboard page", () => {
  assert.equal(
    resolveReservationAnalyticsSource({ referrerPathname: "/dashboard/reservations" }),
    "reservations_list",
  );
  assert.equal(
    resolveReservationAnalyticsSource({ referrerPathname: "/dashboard/customers/customer-1" }),
    "customer_detail",
  );
  assert.equal(resolveReservationAnalyticsSource({}), "direct");
});

test("builds a source-tagged reservation detail URL", () => {
  assert.equal(
    getReservationDetailHref("reservation/with spaces", "home_departure"),
    "/dashboard/reservations/reservation%2Fwith%20spaces?source=home_departure",
  );
});

test("omits returnTo when the caller has no page to come back to", () => {
  assert.equal(
    getReservationDetailHref("reservation-1", "home_departure", null),
    "/dashboard/reservations/reservation-1?source=home_departure",
  );
  assert.equal(
    getReservationDetailHref("reservation-1", "home_departure", ""),
    "/dashboard/reservations/reservation-1?source=home_departure",
  );
});

test("encodes the returnTo path so its own query survives the round-trip", () => {
  assert.equal(
    getReservationDetailHref(
      "reservation-1",
      "reservations_timeline",
      "/dashboard/reservations?view=planning&date=2026-07-08",
    ),
    "/dashboard/reservations/reservation-1?source=reservations_timeline" +
      "&returnTo=%2Fdashboard%2Freservations%3Fview%3Dplanning%26date%3D2026-07-08",
  );
});

test("maps status transitions to their product action", () => {
  assert.equal(
    getReservationStatusAnalyticsAction("ongoing"),
    reservationAnalyticsActions.markPickedUp,
  );
  assert.equal(
    getReservationStatusAnalyticsAction("completed"),
    reservationAnalyticsActions.confirmReturn,
  );
  assert.equal(getReservationStatusAnalyticsAction("cancelled"), null);
});

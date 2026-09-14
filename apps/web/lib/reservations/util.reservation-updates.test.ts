import assert from "node:assert/strict";
import { test } from "node:test";

import { getReservationUpdates, type ReservationActivityRow } from "./util.reservation-updates";

const at = (iso: string) => new Date(iso);

const row = (
  id: string,
  activityType: string,
  createdAt: string,
  metadata: unknown = null,
  description: string | null = null,
): ReservationActivityRow => ({
  id,
  activityType,
  metadata,
  description,
  createdAt: at(createdAt),
});

test("internal rows are dropped and the rest is sorted newest first", () => {
  const updates = getReservationUpdates([
    row("a", "created", "2026-09-01T10:00:00Z"),
    row("b", "note_updated", "2026-09-02T10:00:00Z", { internal: true }),
    row("c", "access_link_sent", "2026-09-02T11:00:00Z"),
    row("d", "payment_initiated", "2026-09-02T12:00:00Z"),
    row("e", "inspection_departure_started", "2026-09-03T10:00:00Z"),
    row("f", "confirmed", "2026-09-02T09:00:00Z"),
  ]);
  assert.deepEqual(
    updates.map((update) => update.id),
    ["f", "a"],
  );
});

test("money movements carry their amount", () => {
  const [captured, authorized, received, manual] = getReservationUpdates([
    row("1", "payment_added", "2026-09-01T10:00:00Z", {
      type: "deposit",
      amount: 100,
      method: "cash",
    }),
    row("2", "payment_received", "2026-09-02T10:00:00Z", { amount: 50, currency: "EUR" }),
    row("3", "deposit_authorized", "2026-09-03T10:00:00Z", { amount: "100" }),
    row("4", "deposit_captured", "2026-09-04T10:00:00Z", {
      capturedAmount: 40,
      originalAmount: 100,
      reason: "Pédale cassée",
    }),
  ]);
  assert.deepEqual(captured, {
    id: "4",
    at: at("2026-09-04T10:00:00Z"),
    kind: "deposit_captured",
    amount: 40,
    reason: "Pédale cassée",
  });
  assert.deepEqual(authorized, {
    id: "3",
    at: at("2026-09-03T10:00:00Z"),
    kind: "deposit_authorized",
    amount: 100,
  });
  assert.deepEqual(received, {
    id: "2",
    at: at("2026-09-02T10:00:00Z"),
    kind: "payment_received",
    amount: 50,
  });
  assert.deepEqual(manual, {
    id: "1",
    at: at("2026-09-01T10:00:00Z"),
    kind: "payment_added",
    paymentType: "deposit",
    amount: 100,
  });
});

test("a dashboard capture stores the amount under `amount`", () => {
  const [captured] = getReservationUpdates([
    row("1", "deposit_captured", "2026-09-04T10:00:00Z", { amount: 25, reason: "Nettoyage" }),
  ]);
  assert.equal(captured?.kind, "deposit_captured");
  if (captured?.kind === "deposit_captured") {
    assert.equal(captured.amount, 25);
    assert.equal(captured.reason, "Nettoyage");
  }
});

test("malformed metadata never throws", () => {
  const updates = getReservationUpdates([
    row("1", "deposit_captured", "2026-09-04T10:00:00Z", "oops"),
    row("2", "payment_added", "2026-09-04T11:00:00Z", { type: "unknown" }),
    row("3", "rejected", "2026-09-04T12:00:00Z", null, "Plus de stock"),
    row("4", "modified", "2026-09-04T13:00:00Z", { garbage: true }),
  ]);
  assert.deepEqual(
    updates.map((update) => update.kind),
    ["modified", "rejected", "deposit_captured"],
  );
  assert.deepEqual(updates[1], {
    id: "3",
    at: at("2026-09-04T12:00:00Z"),
    kind: "rejected",
    reason: "Plus de stock",
  });
});

test("a modification only exposes the period when it changed", () => {
  const [priceOnly, dates] = getReservationUpdates([
    row("1", "modified", "2026-09-05T10:00:00Z", {
      previous: { startDate: "2026-10-01T10:00:00Z", endDate: "2026-10-03T10:00:00Z" },
      updated: { startDate: "2026-10-01T10:00:00Z", endDate: "2026-10-05T10:00:00Z" },
    }),
    row("2", "modified", "2026-09-06T10:00:00Z", {
      previous: { startDate: "2026-10-01T10:00:00Z", endDate: "2026-10-03T10:00:00Z" },
      updated: { startDate: "2026-10-01T10:00:00Z", endDate: "2026-10-03T10:00:00Z" },
    }),
  ]);
  assert.deepEqual(priceOnly, {
    id: "2",
    at: at("2026-09-06T10:00:00Z"),
    kind: "modified",
    startDate: null,
    endDate: null,
  });
  assert.deepEqual(dates, {
    id: "1",
    at: at("2026-09-05T10:00:00Z"),
    kind: "modified",
    startDate: at("2026-10-01T10:00:00Z"),
    endDate: at("2026-10-05T10:00:00Z"),
  });
});

test("extensions surface once confirmed, date requests once filed", () => {
  const updates = getReservationUpdates([
    row("1", "modified", "2026-09-05T10:00:00Z", {
      kind: "rental_extension",
      status: "checkout",
      requestedEndMs: Date.UTC(2026, 9, 6, 10),
    }),
    row("2", "modified", "2026-09-05T11:00:00Z", {
      kind: "rental_extension",
      status: "confirmed",
      requestedEndMs: Date.UTC(2026, 9, 6, 10),
    }),
    row("3", "note_updated", "2026-09-05T12:00:00Z", {
      kind: "return_date_request",
      status: "pending",
    }),
  ]);
  assert.deepEqual(
    updates.map((update) => update.kind),
    ["return_date_requested", "extension_confirmed"],
  );
});

test("cancellations remember who asked, refunds their amount", () => {
  const [refund, byStore, byCustomer] = getReservationUpdates([
    row("1", "cancelled", "2026-09-05T10:00:00Z", { source: "customer_request_cancellation" }),
    row("2", "cancelled", "2026-09-05T11:00:00Z", { previousStatus: "pending" }),
    row("3", "payment_updated", "2026-09-05T12:00:00Z", { refundAmount: 20, isFullRefund: false }),
    row("4", "payment_updated", "2026-09-05T13:00:00Z", { refundAmount: 0 }),
  ]);
  assert.deepEqual(refund, {
    id: "3",
    at: at("2026-09-05T12:00:00Z"),
    kind: "refunded",
    amount: 20,
  });
  assert.deepEqual(byStore, {
    id: "2",
    at: at("2026-09-05T11:00:00Z"),
    kind: "cancelled",
    byCustomer: false,
  });
  assert.deepEqual(byCustomer, {
    id: "1",
    at: at("2026-09-05T10:00:00Z"),
    kind: "cancelled",
    byCustomer: true,
  });
});

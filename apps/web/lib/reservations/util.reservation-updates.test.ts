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

test("cancellations remember who asked", () => {
  const updates = getReservationUpdates([
    row("1", "cancelled", "2026-09-05T10:00:00Z", { source: "customer_request_cancellation" }),
    row("2", "cancelled", "2026-09-05T11:00:00Z", { previousStatus: "pending" }),
  ]);
  assert.deepEqual(updates, [
    { id: "2", at: at("2026-09-05T11:00:00Z"), kind: "cancelled", byCustomer: false },
    { id: "1", at: at("2026-09-05T10:00:00Z"), kind: "cancelled", byCustomer: true },
  ]);
});

// Stripe's count of a charge's refunds (pending ones included) is shown to the customer only
// when no refund row of the reservation stands for a refund of that charge: the oldest
// webhooks stamped the refund on the payment and wrote no row, so the count is all there is.
// When rows exist, the customer's payments list states each refund by its own state.
const countLine = (refundAmount: number) =>
  row("3", "payment_updated", "2026-09-05T12:00:00Z", {
    chargeId: "ch_1",
    refundAmount,
    isFullRefund: false,
  });
// 100.00 netted to 60.00, its refund id stamped on it, no refund row of its own.
const stampedCharge = {
  id: "pay_1",
  type: "rental",
  method: "stripe",
  status: "completed",
  amount: "60.00",
  stripeChargeId: "ch_1",
  stripePaymentIntentId: "pi_1",
  stripeCheckoutSessionId: null,
  stripeRefundId: "re_old",
  refundOfPaymentId: null,
};
const refundRow = (fields: Record<string, unknown>) => ({
  id: "pay_r",
  type: "rental",
  method: "stripe",
  status: "completed",
  amount: "40.00",
  stripeChargeId: null,
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
  stripeRefundId: "re_new",
  refundOfPaymentId: null,
  ...fields,
});

test("the oldest shape: Stripe's count is the customer's only word of the refund, and is kept", () => {
  assert.deepEqual(getReservationUpdates([countLine(40)], [stampedCharge]), [
    { id: "3", at: at("2026-09-05T12:00:00Z"), kind: "stripe_refund_count", amount: 40 },
  ]);
  // A refund row of another charge does not stand for this one.
  assert.equal(
    getReservationUpdates(
      [countLine(40)],
      [stampedCharge, refundRow({ stripeChargeId: "ch_other" })],
    ).length,
    1,
  );
  // Nothing counted, nothing said.
  assert.deepEqual(getReservationUpdates([countLine(0)], [stampedCharge]), []);
});

test("a refund row of that charge stands for the refund: Stripe's count stays out", () => {
  const charge = { ...stampedCharge, stripeRefundId: null };
  // Linked to the charge's payment row.
  assert.deepEqual(
    getReservationUpdates([countLine(40)], [charge, refundRow({ refundOfPaymentId: "pay_1" })]),
    [],
  );
  // Carrying the charge's id (the dashboard's refunds before 2026-08).
  assert.deepEqual(
    getReservationUpdates([countLine(40)], [charge, refundRow({ stripeChargeId: "ch_1" })]),
    [],
  );
  // Neither: the rows cannot tell which charge it came off, so it may be this one's.
  assert.deepEqual(getReservationUpdates([countLine(40)], [charge, refundRow({})]), []);
});

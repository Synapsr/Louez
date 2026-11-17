import assert from "node:assert/strict";
import { test } from "node:test";

import { getRentalPaid } from "@louez/utils";

import { refundStatusByRow } from "@/lib/reservations/util.payment-status";

import {
  type OnlinePaymentRow,
  type PaymentHistoryRow,
  onlineRentalTile,
  paymentHistoryRows,
} from "./util.payment-history";

// The reservation's payment history lists money that moved and the attempts that
// matter to the store. A checkout replaced or expired without payment, whose session
// Stripe says is over, is not one of them: reopening a payment link three times
// leaves three such rows, and none shows. The totals read every row as before.

type Row = PaymentHistoryRow & { id: string; amount: string; refundOfPaymentId: null };

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 16, 9, minutes));
const row = (id: string, fields: Partial<Row>): Row => ({
  id,
  amount: "46.00",
  type: "rental",
  method: "stripe",
  status: "cancelled",
  createdAt: at(0),
  refundOfPaymentId: null,
  stripeCheckoutSessionId: `cs_${id}`,
  sessionSettledAt: at(30),
  ...fields,
});

test("a checkout that took nothing and is over is not listed; one that may still be paid is", () => {
  const rows: Row[] = [
    row("expired_1", { createdAt: at(1) }),
    row("expired_2", { createdAt: at(2) }),
    row("expired_3", { createdAt: at(3) }),
    // Cancelled by the gate, its session not known to be over: it may still be paid.
    row("unsettled", { createdAt: at(4), sessionSettledAt: null }),
    // The checkout open now.
    row("open", { createdAt: at(5), status: "pending", sessionSettledAt: null }),
    // Paid: money that moved.
    row("paid", { createdAt: at(6), status: "completed", sessionSettledAt: null }),
    // A payment recorded by hand, cancelled by the store: not a checkout.
    row("cash", {
      createdAt: at(7),
      method: "cash",
      stripeCheckoutSessionId: null,
      sessionSettledAt: null,
    }),
    // A deposit's checkout, cancelled: the rule is the rental's own.
    row("deposit", { createdAt: at(8), type: "deposit" }),
  ];

  assert.deepEqual(
    paymentHistoryRows(rows).map((payment) => payment.id),
    ["unsettled", "paid", "cash", "deposit"],
  );
  // The totals still read every row, by their own rule.
  assert.equal(getRentalPaid(rows, "EUR"), 46);
});

test("all but the latest refused deposit hold stay out, as before", () => {
  const hold = (id: string, minutes: number) =>
    row(id, {
      type: "deposit_hold",
      status: "failed",
      createdAt: at(minutes),
      stripeCheckoutSessionId: null,
      sessionSettledAt: null,
    });
  assert.deepEqual(
    paymentHistoryRows([hold("hold_1", 1), hold("hold_2", 2)]).map((payment) => payment.id),
    ["hold_2"],
  );
});

// The card's online payment tile tells the latest of the rental's online money: the
// payment received, or, once one is made, a refund of it, said to be a refund. A
// refund Stripe has not settled reads as in progress, one it failed as failed.
const charge: OnlinePaymentRow = {
  id: "charge",
  amount: "32.00",
  type: "rental",
  method: "stripe",
  status: "completed",
  createdAt: at(0),
  paidAt: at(0),
  refundOfPaymentId: null,
  stripeRefundId: null,
  stripePaymentIntentId: "pi_1",
  stripeCheckoutSessionId: "cs_1",
};
const refund = (id: string, minutes: number, fields: Partial<OnlinePaymentRow> = {}) => ({
  ...charge,
  id,
  amount: "10.00",
  createdAt: at(minutes),
  paidAt: at(minutes),
  refundOfPaymentId: "charge",
  stripeRefundId: `re_${id}`,
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
  ...fields,
});

test("the online tile: the payment received while nothing was given back", () => {
  const tile = onlineRentalTile([charge]);
  assert.equal(tile?.payment.id, "charge");
  assert.deepEqual(tile?.reading, { kind: "receipt" });
});

test("the online tile: a refund made after the payment is the tile, as a refund, whatever the rows' order", () => {
  const rows = [refund("first", 16), charge, refund("second", 30)];
  for (const order of [rows, [...rows].reverse()]) {
    const tile = onlineRentalTile(order);
    assert.equal(tile?.payment.id, "second");
    assert.deepEqual(tile?.reading, { kind: "refund", state: "done" });
  }
  // Refunded in full: the charge is `refunded` at zero, the refunds are what is told.
  assert.equal(
    onlineRentalTile([{ ...charge, status: "refunded", amount: "0.00" }, refund("all", 16)])
      ?.payment.id,
    "all",
  );
});

test("the online tile: a refund in progress at Stripe, and one Stripe failed", () => {
  const rows = [charge, refund("r", 16)];
  assert.deepEqual(
    onlineRentalTile(rows, refundStatusByRow([{ refundPaymentId: "r", status: "pending" }]))
      ?.reading,
    { kind: "refund", state: "processing" },
  );
  assert.deepEqual(onlineRentalTile([charge, refund("r", 16, { status: "failed" })])?.reading, {
    kind: "refund",
    state: "failed",
  });
});

test("the online tile: a deposit's refund, a payment by hand and an open checkout are not the rental's online money", () => {
  const rows = [
    refund("deposit_back", 20, { type: "deposit_return", refundOfPaymentId: "capture" }),
    {
      ...charge,
      id: "cash",
      method: "cash",
      createdAt: at(25),
      paidAt: at(25),
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: null,
    },
    { ...charge, id: "open", status: "pending", createdAt: at(26), paidAt: null },
  ];
  assert.equal(onlineRentalTile(rows), null);
  assert.equal(onlineRentalTile([charge, ...rows])?.payment.id, "charge");
});

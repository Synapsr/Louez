import assert from "node:assert/strict";
import { test } from "node:test";

import { getRentalPaid } from "@louez/utils";

import { type PaymentHistoryRow, paymentHistoryRows } from "./util.payment-history";

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

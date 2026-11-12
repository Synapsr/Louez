import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type SettledPaymentRow,
  getSettledPaymentAmount,
  isPaymentInCurrency,
} from "./util.payment-movement";

// A reservation booked in euros, whose store has moved to dollars since.
const row = (overrides: Partial<SettledPaymentRow> = {}): SettledPaymentRow => ({
  id: "payment",
  type: "rental",
  status: "completed",
  amount: "50.00",
  method: "stripe",
  currency: "EUR",
  stripeRefundId: null,
  stripePaymentIntentId: "pi_1",
  stripeCheckoutSessionId: null,
  ...overrides,
});

test("only a Stripe payment states a currency of its own", () => {
  assert.equal(isPaymentInCurrency(row({ currency: "USD" }), "EUR"), false);
  assert.equal(isPaymentInCurrency(row({ currency: "eur" }), "EUR"), true);
  // A Stripe row with none stored is in its reservation's.
  assert.equal(isPaymentInCurrency(row({ currency: null }), "EUR"), true);
  // So is any other payment, whatever the column holds: older manual rows kept its default.
  for (const method of ["cash", "card", "transfer", "check", "other"]) {
    assert.equal(isPaymentInCurrency(row({ method, currency: "USD" }), "EUR"), true, method);
  }
  // A row loaded without its method or its currency counts.
  assert.equal(isPaymentInCurrency({}, "EUR"), true);
  assert.equal(isPaymentInCurrency({ currency: "USD" }, "EUR"), true);
});

test("the settled amount in a currency leaves out a card payment in another", () => {
  const payments = [
    row({ id: "euros", amount: "50.00", currency: "EUR" }),
    row({ id: "dollars", amount: "70.00", currency: "USD" }),
    row({ id: "cash", amount: "20.00", method: "cash", currency: "EUR" }),
    row({ id: "deposit", type: "deposit", amount: "300.00" }),
  ];

  assert.equal(getSettledPaymentAmount(payments, "rental", "EUR"), 70);
  assert.equal(getSettledPaymentAmount(payments, "rental", "USD"), 90);
  // Without a currency, every receipt counts, as before.
  assert.equal(getSettledPaymentAmount(payments, "rental"), 140);
  assert.equal(getSettledPaymentAmount(payments, "deposit", "EUR"), 300);
});

test("a refund follows the payment it gives back, not its own method", () => {
  const charge = row({ id: "dollars", amount: "70.00", currency: "USD" });
  // Given back in cash: the row says nothing of the charge's currency.
  const refund = row({
    id: "refund",
    amount: "30.00",
    method: "cash",
    currency: "EUR",
    refundOfPaymentId: "dollars",
    stripePaymentIntentId: null,
  });

  // The dollars were never counted toward the euros owed: neither is their refund.
  assert.equal(getSettledPaymentAmount([charge, refund], "rental", "EUR"), 0);
  assert.equal(getSettledPaymentAmount([charge, refund], "rental", "USD"), 40);
  assert.equal(getSettledPaymentAmount([charge, refund], "rental"), 40);
});

test("a Stripe refund row counts for nothing, in any currency", () => {
  const charge = row({ id: "charge", amount: "70.00" });
  const stripeRefund = row({
    id: "refund",
    amount: "30.00",
    refundOfPaymentId: "charge",
    stripeRefundId: "re_1",
    stripePaymentIntentId: null,
  });

  assert.equal(getSettledPaymentAmount([charge, stripeRefund], "rental", "EUR"), 70);
  assert.equal(getSettledPaymentAmount([charge, stripeRefund], "rental"), 70);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getNetCompletedPaymentAmount,
  getRemainingRefundableAmount,
  isManualPaymentRefundEligible,
  type PaymentRefundState,
} from "./util.payment-refunds";

const row = (overrides: Partial<PaymentRefundState> & { id: string }): PaymentRefundState => ({
  amount: "100.00",
  type: "rental",
  method: "cash",
  status: "completed",
  refundOfPaymentId: null,
  stripeRefundId: null,
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
  ...overrides,
});

test("manual refunds come off what is left to give back", () => {
  const original = row({ id: "cash" });
  const payments = [
    original,
    row({ id: "r1", amount: "30.00", refundOfPaymentId: "cash" }),
    row({ id: "r2", amount: "20.00", refundOfPaymentId: "cash" }),
    row({ id: "r3", amount: "10.00", refundOfPaymentId: "cash", status: "pending" }),
  ];

  assert.equal(getRemainingRefundableAmount(original, payments), 50);
  assert.equal(isManualPaymentRefundEligible(original, payments), true);
});

test("a Stripe refund linked to its charge is not taken off a second time", () => {
  // 100 charged, 30 refunded: the webhook left the charge at 70.
  const charge = row({
    id: "charge",
    amount: "70.00",
    method: "stripe",
    stripePaymentIntentId: "pi_1",
  });
  const payments = [
    charge,
    row({
      id: "refund",
      amount: "30.00",
      method: "stripe",
      stripeRefundId: "re_1",
      refundOfPaymentId: "charge",
    }),
  ];

  assert.equal(getRemainingRefundableAmount(charge, payments), 70);
  assert.equal(getNetCompletedPaymentAmount(payments, "rental"), 70);
});

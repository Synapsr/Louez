import assert from "node:assert/strict";
import { test } from "node:test";

import { validateStripePaymentAmount } from "./util.stripe-payment-amount";

test("EUR card payments reject tiny totals and accept the exact minimum", () => {
  for (const amount of [0.09, 0.1, 0.49]) {
    assert.deepEqual(validateStripePaymentAmount(amount, "eur"), {
      ok: false,
      error: "errors.paymentAmountTooSmall",
      params: { minimumAmount: 0.5, currency: "EUR" },
    });
  }
  for (const amount of [0.5, 1, 100])
    assert.deepEqual(validateStripePaymentAmount(amount, "EUR"), { ok: true });
});

test("currency minimums do not impose the EUR threshold on GBP or JPY", () => {
  assert.equal(validateStripePaymentAmount(0.3, "GBP").ok, true);
  assert.equal(validateStripePaymentAmount(0.29, "GBP").ok, false);
  assert.equal(validateStripePaymentAmount(49, "JPY").ok, false);
  assert.equal(validateStripePaymentAmount(50, "JPY").ok, true);
});

test("invalid numeric amounts cannot reach Stripe", () => {
  for (const amount of [-1, 0, NaN, Infinity]) {
    assert.deepEqual(validateStripePaymentAmount(amount, "EUR"), {
      ok: false,
      error: "errors.invalidAmount",
    });
  }
});

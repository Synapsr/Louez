import assert from "node:assert/strict";
import { test } from "node:test";

import { cartResetOutcome } from "./util.cart-reset-outcome";

// What the reservation page states as done for the cart, from its `?event`
// and the payment status the server read.

test("a payment is stated only once it is recorded", () => {
  assert.equal(cartResetOutcome("paid", "received"), "paid");
  for (const status of ["processing", "unpaid", "paid", "failed"]) {
    assert.equal(cartResetOutcome("paid", status), null);
  }
});

test("a request's landing states a request, whatever the payment status, and never a payment", () => {
  for (const status of ["processing", "unpaid", "received"]) {
    assert.equal(cartResetOutcome("requested", status), "requested");
  }
});

test("any other event, or none, states nothing", () => {
  for (const event of [null, undefined, "", "payment_received", "deposit_authorized", "PAID"]) {
    assert.equal(cartResetOutcome(event, "received"), null);
  }
});

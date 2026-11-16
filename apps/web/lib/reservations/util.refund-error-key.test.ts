import assert from "node:assert/strict";
import { test } from "node:test";

import { paymentRecordErrors } from "@louez/api/contracts/payment-records";
import { reservationErrors } from "@louez/api/contracts/reservations";

import { refundErrorKey } from "./util.refund-error-key";

test("a refund not recorded says why in the dashboard's words: not found, busy, or the amount", () => {
  assert.equal(
    refundErrorKey(paymentRecordErrors.paymentNotFound("pay_1")),
    "errors.paymentNotFound",
  );
  // The reservation was being changed: try again, never "invalid amount".
  assert.equal(refundErrorKey(reservationErrors.busy("res_1")), "errors.reservationStatusChanged");
  assert.equal(refundErrorKey(paymentRecordErrors.refundStripePayment()), "errors.invalidAmount");
  assert.equal(refundErrorKey(new Error("the database is gone")), "errors.invalidAmount");
});

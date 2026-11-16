import assert from "node:assert/strict";
import { test } from "node:test";

import { paymentRecordErrors } from "@louez/api/contracts/payment-records";
import { reservationErrors } from "@louez/api/contracts/reservations";

import { paymentErrorKey } from "./util.payment-error-key";

test("a refund or a deposit return not recorded says why in the dashboard's words", () => {
  assert.equal(
    paymentErrorKey(paymentRecordErrors.paymentNotFound("pay_1")),
    "errors.paymentNotFound",
  );
  // The reservation was being changed: try again, never "invalid amount".
  assert.equal(paymentErrorKey(reservationErrors.busy("res_1")), "errors.reservationStatusChanged");
  assert.equal(paymentErrorKey(paymentRecordErrors.refundStripePayment()), "errors.invalidAmount");
  assert.equal(paymentErrorKey(new Error("the database is gone")), "errors.invalidAmount");
  // Too many decimals says so; a malformed amount stays invalid.
  assert.equal(
    paymentErrorKey(paymentRecordErrors.refundAmountTooPrecise("EUR", 2)),
    "errors.amountTooPrecise",
  );
  assert.equal(
    paymentErrorKey(paymentRecordErrors.depositReturnAmountTooPrecise("JPY", 0)),
    "errors.amountTooPrecise",
  );
  assert.equal(paymentErrorKey(paymentRecordErrors.refundAmountInvalid()), "errors.invalidAmount");
  assert.equal(
    paymentErrorKey(paymentRecordErrors.currencyNotSupported("KWD")),
    "errors.currencyNotSupportedForPayments",
  );
  assert.equal(
    paymentErrorKey(paymentRecordErrors.reservationNotFound("res_1")),
    "errors.reservationNotFound",
  );
});

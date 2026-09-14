import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyDepositHold } from "./util.deposit-hold";

const expected = { reservationId: "res_1", amountCents: 50000, currency: "EUR" };
const valid = {
  status: "requires_capture",
  amount: 50000,
  currency: "eur",
  paymentMethodId: "pm_1",
  metadataReservationId: "res_1",
};

describe("verifyDepositHold", () => {
  it("accepts a capturable hold of the deposit for the reservation", () => {
    assert.deepEqual(verifyDepositHold(valid, expected), { ok: true, paymentMethodId: "pm_1" });
  });

  it("rejects an intent minted for another reservation", () => {
    assert.deepEqual(verifyDepositHold({ ...valid, metadataReservationId: "res_2" }, expected), {
      ok: false,
      reason: "wrong_reservation",
    });
  });

  it("rejects an intent that is not awaiting capture", () => {
    for (const status of ["requires_payment_method", "processing", "succeeded", "canceled"]) {
      assert.equal(verifyDepositHold({ ...valid, status }, expected).ok, false);
    }
  });

  it("rejects a different amount or currency", () => {
    assert.deepEqual(verifyDepositHold({ ...valid, amount: 49900 }, expected), {
      ok: false,
      reason: "amount_mismatch",
    });
    assert.deepEqual(verifyDepositHold({ ...valid, currency: "usd" }, expected), {
      ok: false,
      reason: "amount_mismatch",
    });
  });

  it("requires a payment method to keep for the capture", () => {
    assert.deepEqual(verifyDepositHold({ ...valid, paymentMethodId: null }, expected), {
      ok: false,
      reason: "no_payment_method",
    });
  });
});

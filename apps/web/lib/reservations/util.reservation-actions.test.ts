import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getReservationActions } from "./util.reservation-actions";

const base = {
  isRentalPaid: false,
  isSigned: false,
  stripeAccountId: "acct_1",
  stripeChargesEnabled: true,
};

describe("getReservationActions", () => {
  test("quote: accept first, no contract, no payment", () => {
    const actions = getReservationActions({ ...base, status: "quote" });
    assert.equal(actions.required, "quote");
    assert.equal(actions.canAcceptQuote, true);
    assert.equal(actions.canPay, false);
    assert.equal(actions.canDownloadContract, false);
    assert.equal(actions.canSign, false);
  });

  test("pending: cancellation is optional", () => {
    const actions = getReservationActions({ ...base, status: "pending" });
    assert.equal(actions.required, null);
    assert.equal(actions.canCancelRequest, true);
    assert.deepEqual(
      [actions.canAcceptQuote, actions.canPay, actions.canSign, actions.canDownloadContract],
      [false, false, false, false],
    );
  });

  test("confirmed: payment is the only required step; no signature even for existing unsigned bookings", () => {
    const unpaid = getReservationActions({ ...base, status: "confirmed" });
    assert.equal(unpaid.required, "payment");
    assert.equal(unpaid.canPay, true);
    assert.equal(unpaid.canSign, false);
    assert.equal(unpaid.canDownloadContract, true);

    const paid = getReservationActions({
      ...base,
      status: "confirmed",
      isRentalPaid: true,
    });
    assert.equal(paid.required, null);
    assert.equal(paid.canPay, false);

    const signed = getReservationActions({
      ...base,
      status: "confirmed",
      isRentalPaid: true,
      isSigned: true,
    });
    assert.equal(signed.required, null);
    assert.equal(signed.canDownloadContract, true);
  });

  test("no Stripe: no payment action", () => {
    assert.equal(
      getReservationActions({
        ...base,
        status: "ongoing",
        stripeChargesEnabled: false,
      }).canPay,
      false,
    );
    assert.equal(
      getReservationActions({
        ...base,
        status: "ongoing",
        stripeAccountId: null,
      }).canPay,
      false,
    );
  });

  test("completed: contract stays downloadable without a signature step", () => {
    const actions = getReservationActions({ ...base, status: "completed" });
    assert.equal(actions.required, null);
    assert.equal(actions.canDownloadContract, true);
    assert.equal(actions.canSign, false);
    assert.equal(actions.canPay, false);
  });

  test("closed statuses expose nothing", () => {
    for (const status of ["cancelled", "rejected", "declined"]) {
      const actions = getReservationActions({ ...base, status });
      assert.equal(actions.required, null);
      assert.equal(actions.canDownloadContract, false);
    }
  });
});

test("only pending requests can be cancelled by customers", () => {
  for (const status of [
    "quote",
    "confirmed",
    "ongoing",
    "completed",
    "cancelled",
    "rejected",
    "declined",
    "unknown",
  ]) {
    assert.equal(getReservationActions({ ...base, status }).canCancelRequest, false, status);
  }
});

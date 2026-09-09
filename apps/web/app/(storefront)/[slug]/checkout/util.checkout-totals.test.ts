import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateCheckoutTotals, getCheckoutSubmitLabel } from "./util.checkout-totals";

describe("calculateCheckoutTotals", () => {
  it("adds delivery and insurance and removes the promo", () => {
    const totals = calculateCheckoutTotals({
      subtotal: 100,
      discountAmount: 10,
      deliveryFee: 15,
      insuranceAmount: 4.5,
      depositPercentage: 100,
      reservationMode: "payment",
    });

    assert.equal(totals.total, 109.5);
    assert.equal(totals.subtotalWithInsurance, 104.5);
    assert.equal(totals.isPartialPayment, false);
    assert.equal(totals.amountDueNow, 109.5);
    assert.equal(totals.remainingAmount, 0);
  });

  it("charges the deposit on the full total, delivery included, like the server", () => {
    const totals = calculateCheckoutTotals({
      subtotal: 100,
      discountAmount: 0,
      deliveryFee: 20,
      insuranceAmount: 0,
      depositPercentage: 30,
      reservationMode: "payment",
    });

    assert.equal(totals.isPartialPayment, true);
    assert.equal(totals.amountDueNow, 36);
    assert.equal(totals.remainingAmount, 84);
  });

  it("floors the deposit to the Stripe minimum and caps it to the total", () => {
    const tiny = calculateCheckoutTotals({
      subtotal: 1,
      discountAmount: 0,
      deliveryFee: 0,
      insuranceAmount: 0,
      depositPercentage: 10,
      reservationMode: "payment",
    });
    assert.equal(tiny.amountDueNow, 0.5);

    const smaller = calculateCheckoutTotals({
      subtotal: 0.3,
      discountAmount: 0,
      deliveryFee: 0,
      insuranceAmount: 0,
      depositPercentage: 10,
      reservationMode: "payment",
    });
    assert.equal(smaller.amountDueNow, 0.3);
  });

  it("never goes below zero when the promo exceeds the subtotal", () => {
    const totals = calculateCheckoutTotals({
      subtotal: 10,
      discountAmount: 25,
      deliveryFee: 5,
      insuranceAmount: 0,
      depositPercentage: 100,
      reservationMode: "request",
    });

    assert.equal(totals.total, 5);
    assert.equal(totals.amountDueNow, 0);
    assert.equal(totals.remainingAmount, 5);
  });

  it("ignores the deposit percentage in request mode", () => {
    const totals = calculateCheckoutTotals({
      subtotal: 80,
      discountAmount: 0,
      deliveryFee: 0,
      insuranceAmount: 0,
      depositPercentage: 50,
      reservationMode: "request",
    });

    assert.equal(totals.isPartialPayment, false);
    assert.equal(totals.amountDueNow, 0);
  });
});

describe("getCheckoutSubmitLabel", () => {
  it("returns request in request mode", () => {
    const totals = calculateCheckoutTotals({
      subtotal: 80,
      discountAmount: 0,
      deliveryFee: 0,
      insuranceAmount: 0,
      depositPercentage: 100,
      reservationMode: "request",
    });
    assert.deepEqual(getCheckoutSubmitLabel(totals, "request"), { kind: "request" });
  });

  it("returns pay or payDeposit with the amount due now", () => {
    const full = calculateCheckoutTotals({
      subtotal: 80,
      discountAmount: 0,
      deliveryFee: 0,
      insuranceAmount: 0,
      depositPercentage: 100,
      reservationMode: "payment",
    });
    assert.deepEqual(getCheckoutSubmitLabel(full, "payment"), { kind: "pay", amount: 80 });

    const partial = calculateCheckoutTotals({
      subtotal: 80,
      discountAmount: 0,
      deliveryFee: 0,
      insuranceAmount: 0,
      depositPercentage: 25,
      reservationMode: "payment",
    });
    assert.deepEqual(getCheckoutSubmitLabel(partial, "payment"), {
      kind: "payDeposit",
      amount: 20,
    });
  });
});

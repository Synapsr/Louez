import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateCheckoutTotals,
  calculateCustomerDiscountBreakdown,
  getCheckoutSubtotalDisplay,
  getCheckoutSubmitLabel,
} from "./util.checkout-totals";

describe("getCheckoutSubtotalDisplay", () => {
  it("shows only the negotiable label when the regular subtotal is zero", () => {
    assert.deepEqual(
      getCheckoutSubtotalDisplay({
        subtotal: 0,
        originalSubtotal: 0,
        totalSavings: 0,
        hasNegotiableItems: true,
      }),
      { kind: "negotiable" },
    );
  });

  it("combines a positive regular subtotal with the negotiable label", () => {
    assert.deepEqual(
      getCheckoutSubtotalDisplay({
        subtotal: 80,
        originalSubtotal: 100,
        totalSavings: 20,
        hasNegotiableItems: true,
      }),
      { kind: "amountAndNegotiable", amount: 100 },
    );
  });

  it("keeps the existing numeric subtotal display when no items are negotiable", () => {
    assert.deepEqual(
      getCheckoutSubtotalDisplay({
        subtotal: 80,
        originalSubtotal: 100,
        totalSavings: 20,
        hasNegotiableItems: false,
      }),
      { kind: "amount", amount: 100 },
    );
  });
});

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

describe("calculateCustomerDiscountBreakdown", () => {
  it("computes normal total, discount amount, and discounted total for customer percentage discount", () => {
    const breakdown = calculateCustomerDiscountBreakdown({
      subtotal: 500,
      promoDiscountAmount: 0,
      customerDiscountPercent: 15,
      deliveryFee: 50,
      insuranceAmount: 0,
    });

    assert.deepEqual(breakdown, {
      discountPercent: 15,
      discountAmount: 75,
      totalDiscountAmount: 75,
      normalTotal: 550,
      discountedTotal: 475,
    });
  });

  it("applies customer percentage discount on remaining subtotal after promo code", () => {
    const breakdown = calculateCustomerDiscountBreakdown({
      subtotal: 400,
      promoDiscountAmount: 100,
      customerDiscountPercent: 10,
      deliveryFee: 20,
      insuranceAmount: 10,
    });

    assert.deepEqual(breakdown, {
      discountPercent: 10,
      discountAmount: 30,
      totalDiscountAmount: 130,
      normalTotal: 330,
      discountedTotal: 300,
    });
  });

  it("returns zero discount when customerDiscountPercent is 0", () => {
    const breakdown = calculateCustomerDiscountBreakdown({
      subtotal: 300,
      customerDiscountPercent: 0,
    });

    assert.deepEqual(breakdown, {
      discountPercent: 0,
      discountAmount: 0,
      totalDiscountAmount: 0,
      normalTotal: 300,
      discountedTotal: 300,
    });
  });
});

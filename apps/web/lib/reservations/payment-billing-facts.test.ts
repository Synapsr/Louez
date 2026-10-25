import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ReservationTotalsInput } from "@/lib/billing-sync/money";

import { grossMinorOf, recordedPaymentFacts, reservationCurrency } from "./payment-billing-facts";

// 110.00 tax included, 10.00 of it insurance.
const insured: ReservationTotalsInput = {
  reservation: {
    createdAt: new Date("2026-10-01T10:00:00Z"),
    currency: null,
    totalAmount: "110.00",
    subtotalAmount: "100.00",
    depositAmount: "0.00",
    tulipInsuranceAmount: "10.00",
  },
  storeSettings: { currency: "usd" },
  items: [
    { productId: "product", taxRate: "20.00", totalPrice: "100.00" },
    { productId: null, taxRate: null, totalPrice: "10.00" },
  ],
};

describe("reservationCurrency", () => {
  test("the reservation's frozen currency wins over the store's", () => {
    assert.equal(reservationCurrency("JPY", { currency: "EUR" }), "JPY");
  });

  test("an older reservation takes the store's currency, upper-cased", () => {
    assert.equal(reservationCurrency(null, { currency: "usd" }), "USD");
  });

  test("with neither, EUR", () => {
    assert.equal(reservationCurrency(null, null), "EUR");
  });
});

describe("grossMinorOf", () => {
  test("cents for a two-decimal currency, whole units for a zero-decimal one", () => {
    assert.equal(grossMinorOf("12.34", "EUR"), 1234);
    assert.equal(grossMinorOf("1500.00", "JPY"), 1500);
    assert.equal(grossMinorOf("-12.35", "EUR"), -1235);
  });

  test("null for a three-decimal currency, which the contract does not support", () => {
    assert.equal(grossMinorOf("12.34", "KWD"), null);
  });
});

describe("recordedPaymentFacts", () => {
  test("a rental payment carries its part of the insurance", () => {
    assert.deepEqual(recordedPaymentFacts({ type: "rental", amount: "55.00", totals: insured }), {
      currency: "USD",
      grossMinor: 5500,
      insuranceShareMinor: 500,
    });
  });

  test("other kinds carry no insurance", () => {
    for (const type of ["deposit", "deposit_return", "damage", "adjustment"] as const) {
      assert.deepEqual(recordedPaymentFacts({ type, amount: "55.00", totals: insured }), {
        currency: "USD",
        grossMinor: 5500,
        insuranceShareMinor: 0,
      });
    }
  });

  test("a negative adjustment keeps its sign", () => {
    assert.equal(
      recordedPaymentFacts({ type: "adjustment", amount: "-20.00", totals: insured }).grossMinor,
      -2000,
    );
  });

  test("in a store that prices before tax, the share is taken on the total with tax", () => {
    // Dashboard items have no tax rate: 100.00 before tax plus 20 % is 120.00,
    // and the 10.00 insurance is exempt, so the total is 130.00.
    const exclusive: ReservationTotalsInput = {
      ...insured,
      storeSettings: {
        currency: "EUR",
        tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
      },
      items: [
        { productId: "product", taxRate: null, totalPrice: "100.00" },
        { productId: null, taxRate: null, totalPrice: "10.00" },
      ],
    };
    assert.deepEqual(recordedPaymentFacts({ type: "rental", amount: "65.00", totals: exclusive }), {
      currency: "EUR",
      grossMinor: 6500,
      insuranceShareMinor: 500,
    });
  });

  test("an unsupported currency records no gross and no share", () => {
    const kuwaiti: ReservationTotalsInput = {
      ...insured,
      reservation: { ...insured.reservation, currency: "KWD" },
    };
    assert.deepEqual(recordedPaymentFacts({ type: "rental", amount: "55.00", totals: kuwaiti }), {
      currency: "KWD",
      grossMinor: null,
      insuranceShareMinor: null,
    });
  });
});

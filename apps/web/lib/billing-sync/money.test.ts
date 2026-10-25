import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  beforeTaxRateBps,
  insuranceShare,
  mulDivHalfUp,
  reservationTotalsMinor,
  rhu,
  toMinor,
} from "./money";

// The public vectors of the billing contract (fees.md §2-§4), copied from the
// service's docs. A vector passes when the output equals `expected` exactly.
const vectors: Array<{
  id: string;
  function: string;
  input: Record<string, unknown>;
  expected: unknown;
}> = JSON.parse(
  readFileSync(new URL("./fee-vectors.public.json", import.meta.url), "utf8"),
).vectors;

describe("fee vectors", () => {
  for (const vector of vectors) {
    test(vector.id, () => {
      const i = vector.input as Record<string, number & string>;
      const actual =
        vector.function === "toMinor"
          ? toMinor(i.decimal, i.currency)
          : vector.function === "insuranceShare"
            ? insuranceShare({
                insuranceMinor: i.insuranceMinor,
                grossMinor: i.grossMinor,
                totalInclTaxMinor: i.totalInclTaxMinor,
              })
            : vector.function === "rhu"
              ? Number(rhu(BigInt(i.x), BigInt(i.bps)))
              : Number(mulDivHalfUp(BigInt(i.a), BigInt(i.n), BigInt(i.d)));
      assert.deepEqual(actual, vector.expected);
    });
  }
});

describe("reservationTotalsMinor", () => {
  // A checkout booking in a store that prices tax included: the tax engine's split
  // (100.00 + 20.00) adds up to the total.
  const base = {
    reservation: {
      createdAt: new Date("2026-10-01T10:00:00Z"),
      currency: null,
      source: "online",
      totalAmount: "120.00",
      subtotalAmount: "120.00",
      depositAmount: "0.00",
      deliveryFee: "0.00",
      discountAmount: "0.00",
      subtotalExclTax: "100.00",
      taxAmount: "20.00",
      tulipInsuranceAmount: null,
    },
    storeSettings: {
      currency: "eur",
      tax: { enabled: true, defaultRate: 20, displayMode: "inclusive" as const },
    },
    items: [{ productId: "p1", taxRate: "20.00", totalPrice: "120.00" }],
  };
  const exclusive = {
    currency: "EUR",
    tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" as const },
  };
  // Manual creation writes no split and no item rate.
  const manual = { ...base.reservation, source: "manual", subtotalExclTax: null, taxAmount: null };

  test("reads a tax-included total as is, in the store's currency upper-cased", () => {
    assert.deepEqual(reservationTotalsMinor(base), {
      currency: "EUR",
      totalInclTaxMinor: 12000,
      insuranceMinor: 0,
    });
  });

  test("adds the default rate to a dashboard total in a store that prices before tax, insurance excluded", () => {
    const totals = reservationTotalsMinor({
      reservation: {
        ...manual,
        totalAmount: "110.00",
        subtotalAmount: "110.00",
        tulipInsuranceAmount: "10.00",
      },
      storeSettings: exclusive,
      items: [
        { productId: "p1", taxRate: null, totalPrice: "100.00" },
        { productId: null, taxRate: null, totalPrice: "10.00" },
      ],
    });
    assert.deepEqual(totals, { currency: "EUR", totalInclTaxMinor: 13000, insuranceMinor: 1000 });
  });

  test("leaves a checkout total alone in a store that prices before tax", () => {
    const totals = reservationTotalsMinor({
      reservation: { ...base.reservation, subtotalAmount: "100.00" },
      storeSettings: exclusive,
      items: [{ productId: "p1", taxRate: "20.00", totalPrice: "100.00" }],
    });
    assert.equal(totals.totalInclTaxMinor, 12000);
  });

  test("adds tax to a checkout booking the dashboard edited, at the item's own rate", () => {
    // Booked at 100.00 + 20 %; the edit repriced the item to 150.00 before tax,
    // stored a total of 150.00 and left the item rate and the split as they were.
    const totals = reservationTotalsMinor({
      reservation: { ...base.reservation, totalAmount: "150.00", subtotalAmount: "150.00" },
      storeSettings: exclusive,
      items: [{ productId: "p1", taxRate: "20.00", totalPrice: "150.00" }],
    });
    assert.equal(totals.totalInclTaxMinor, 18000);
  });

  test("taxes an edited total line by line, the discount spread over the taxed lines", () => {
    // What the checkout charges for these lines: (100 − 10) × 1.055 + (50 − 5) × 1.2
    // + (10 − 1) × 1.2 for the delivery + 10 of insurance = 169.75.
    const totals = reservationTotalsMinor({
      reservation: {
        ...base.reservation,
        totalAmount: "154.00",
        subtotalAmount: "160.00",
        deliveryFee: "10.00",
        discountAmount: "16.00",
        tulipInsuranceAmount: "10.00",
      },
      storeSettings: exclusive,
      items: [
        { productId: "p1", taxRate: "5.50", totalPrice: "100.00" },
        { productId: "p2", taxRate: null, totalPrice: "50.00" },
        { productId: null, taxRate: null, totalPrice: "10.00" },
      ],
    });
    assert.deepEqual(totals, { currency: "EUR", totalInclTaxMinor: 16975, insuranceMinor: 1000 });
  });

  test("adds no tax to a checkout booking taken with taxes off, after the store turns them on", () => {
    const totals = reservationTotalsMinor({
      reservation: {
        ...base.reservation,
        totalAmount: "100.00",
        subtotalAmount: "100.00",
        subtotalExclTax: null,
        taxAmount: null,
      },
      storeSettings: exclusive,
      items: [{ productId: "p1", taxRate: null, totalPrice: "100.00" }],
    });
    assert.equal(totals.totalInclTaxMinor, 10000);
  });

  test("keeps a checkout booking taken tax included after the store switches to before tax", () => {
    assert.equal(
      reservationTotalsMinor({ ...base, storeSettings: exclusive }).totalInclTaxMinor,
      12000,
    );
  });

  test("leaves a checkout total alone when every line is at 0 %", () => {
    const totals = reservationTotalsMinor({
      reservation: {
        ...base.reservation,
        totalAmount: "100.00",
        subtotalAmount: "100.00",
        taxAmount: "0.00",
      },
      storeSettings: exclusive,
      items: [{ productId: "p1", taxRate: "0.00", totalPrice: "100.00" }],
    });
    assert.equal(totals.totalInclTaxMinor, 10000);
  });

  test("drops the deposit from a total of before April 2026 that includes it", () => {
    const totals = reservationTotalsMinor({
      ...base,
      reservation: {
        ...base.reservation,
        createdAt: new Date("2026-02-10T10:00:00Z"),
        totalAmount: "170.00",
        depositAmount: "50.00",
      },
    });
    assert.equal(totals.totalInclTaxMinor, 12000);
  });

  test("keeps a recent total whose delivery fee exceeds the deposit", () => {
    const totals = reservationTotalsMinor({
      ...base,
      reservation: {
        ...base.reservation,
        totalAmount: "130.00",
        subtotalAmount: "100.00",
        depositAmount: "25.00",
      },
    });
    assert.equal(totals.totalInclTaxMinor, 13000);
  });

  test("prefers the reservation's frozen currency, and counts yen in whole units", () => {
    const totals = reservationTotalsMinor({
      ...base,
      reservation: {
        ...base.reservation,
        currency: "JPY",
        totalAmount: "12000.00",
        subtotalAmount: "12000.00",
      },
    });
    assert.deepEqual(totals, { currency: "JPY", totalInclTaxMinor: 12000, insuranceMinor: 0 });
  });
});

describe("beforeTaxRateBps", () => {
  test("is the default rate of a store that prices excluding tax, and null otherwise", () => {
    const tax = { enabled: true, defaultRate: 5.5, displayMode: "exclusive" as const };
    assert.equal(beforeTaxRateBps(tax), 550);
    assert.equal(beforeTaxRateBps({ ...tax, taxLabel: "VAT", taxNumber: "FR1" }), 550);
    assert.equal(beforeTaxRateBps({ ...tax, displayMode: "inclusive" }), null);
    assert.equal(beforeTaxRateBps({ ...tax, enabled: false }), null);
    assert.equal(beforeTaxRateBps(undefined), null);
  });
});

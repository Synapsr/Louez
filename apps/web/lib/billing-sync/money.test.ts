import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { insuranceShare, mulDivHalfUp, reservationTotalsMinor, rhu, toMinor } from "./money";

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
  const base = {
    reservation: {
      currency: null,
      totalAmount: "120.00",
      subtotalAmount: "120.00",
      depositAmount: "0.00",
      tulipInsuranceAmount: null,
    },
    storeSettings: {
      currency: "eur",
      tax: { enabled: true, defaultRate: 20, displayMode: "inclusive" as const },
    },
    items: [{ productId: "p1", taxRate: "20.00", totalPrice: "120.00" }],
  };

  test("reads a tax-included total as is, in the store's currency upper-cased", () => {
    assert.deepEqual(reservationTotalsMinor(base), {
      currency: "EUR",
      totalInclTaxMinor: 12000,
      insuranceMinor: 0,
    });
  });

  test("adds the default rate to a dashboard total in a store that prices before tax, insurance excluded", () => {
    const totals = reservationTotalsMinor({
      ...base,
      reservation: {
        ...base.reservation,
        totalAmount: "110.00",
        subtotalAmount: "110.00",
        tulipInsuranceAmount: "10.00",
      },
      storeSettings: {
        currency: "EUR",
        tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
      },
      items: [
        { productId: "p1", taxRate: null, totalPrice: "100.00" },
        { productId: null, taxRate: null, totalPrice: "10.00" },
      ],
    });
    assert.deepEqual(totals, { currency: "EUR", totalInclTaxMinor: 13000, insuranceMinor: 1000 });
  });

  test("leaves a storefront total alone in a store that prices before tax", () => {
    const totals = reservationTotalsMinor({
      ...base,
      storeSettings: {
        currency: "EUR",
        tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
      },
    });
    assert.equal(totals.totalInclTaxMinor, 12000);
  });

  test("drops the deposit from an old total that includes it", () => {
    const totals = reservationTotalsMinor({
      ...base,
      reservation: { ...base.reservation, totalAmount: "170.00", depositAmount: "50.00" },
    });
    assert.equal(totals.totalInclTaxMinor, 12000);
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

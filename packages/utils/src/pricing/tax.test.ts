import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateTaxBreakdown, roundToMinorUnit } from "./tax";

test("inclusive tax calculation preserves the customer-facing total", () => {
  const calculation = calculateTaxBreakdown({
    lines: [
      { id: "standard-rate-product", amount: 120, taxRate: 20 },
      { id: "reduced-rate-product", amount: 55, taxRate: 5.5 },
    ],
    deliveryFee: 12,
    discountAmount: 17,
    depositAmount: 200,
    taxConfig: { enabled: true, rate: 20, displayMode: "inclusive" },
  });

  assert.equal(calculation.totalInclTax, 170);
});

test("delivery enters the VAT base at the store default rate", () => {
  const calculation = calculateTaxBreakdown({
    lines: [{ id: "product", amount: 100, taxRate: 20 }],
    deliveryFee: 10,
    taxConfig: { enabled: true, rate: 20, displayMode: "exclusive" },
  });

  assert.deepEqual(calculation.vatBreakdown, [{ rate: 20, baseExclTax: 110, taxAmount: 22 }]);
  assert.equal(calculation.totalInclTax, 132);
});

test("promo discount is allocated proportionally across mixed VAT rates", () => {
  const calculation = calculateTaxBreakdown({
    lines: [
      { id: "standard-rate-product", amount: 120, taxRate: 20 },
      { id: "reduced-rate-product", amount: 55, taxRate: 5.5 },
    ],
    deliveryFee: 12,
    discountAmount: 17,
    taxConfig: { enabled: true, rate: 20, displayMode: "inclusive" },
  });

  assert.deepEqual(
    calculation.lines.map(({ id, discountAmount }) => ({
      id,
      discountAmount,
    })),
    [
      { id: "standard-rate-product", discountAmount: 10.91 },
      { id: "reduced-rate-product", discountAmount: 5 },
      { id: "delivery", discountAmount: 1.09 },
    ],
  );
  assert.deepEqual(calculation.vatBreakdown, [
    { rate: 5.5, baseExclTax: 47.39, taxAmount: 2.61 },
    { rate: 20, baseExclTax: 100, taxAmount: 20 },
  ]);
  assert.equal(calculation.subtotalExclTax, 147.39);
  assert.equal(calculation.taxAmount, 22.61);
});

test("deposit stays outside the VAT base and customer-facing rental total", () => {
  const calculation = calculateTaxBreakdown({
    lines: [{ id: "product", amount: 100, taxRate: 20 }],
    depositAmount: 200,
    taxConfig: { enabled: true, rate: 20, displayMode: "exclusive" },
  });

  assert.equal(calculation.depositAmount, 200);
  assert.equal(calculation.subtotalExclTax, 100);
  assert.equal(calculation.taxAmount, 20);
  assert.equal(calculation.totalInclTax, 120);
  assert.deepEqual(calculation.vatBreakdown, [{ rate: 20, baseExclTax: 100, taxAmount: 20 }]);
});

test("breakdown sums tax rounded on each line and reconciles to the cent", () => {
  const calculation = calculateTaxBreakdown({
    lines: [
      { id: "small-line-1", amount: 0.03, taxRate: 20 },
      { id: "small-line-2", amount: 0.03, taxRate: 20 },
    ],
    taxConfig: { enabled: true, rate: 20, displayMode: "exclusive" },
  });

  assert.deepEqual(calculation.lines, [
    {
      id: "small-line-1",
      taxRate: 20,
      discountAmount: 0,
      amountExclTax: 0.03,
      taxAmount: 0.01,
      amountInclTax: 0.04,
    },
    {
      id: "small-line-2",
      taxRate: 20,
      discountAmount: 0,
      amountExclTax: 0.03,
      taxAmount: 0.01,
      amountInclTax: 0.04,
    },
  ]);
  assert.deepEqual(calculation.vatBreakdown, [{ rate: 20, baseExclTax: 0.06, taxAmount: 0.02 }]);
  assert.equal(calculation.subtotalExclTax + calculation.taxAmount, 0.08);
  assert.equal(calculation.totalInclTax, 0.08);
});

// The engine in the currency's minor unit: ¥1 for the yen, 1 cent for the euro.
const YEN_HT = { enabled: true, rate: 10, displayMode: "exclusive" as const };
const YEN_TTC = { enabled: true, rate: 10, displayMode: "inclusive" as const };

test("yen before tax: the tax and the total are whole yen", () => {
  const calculation = calculateTaxBreakdown({
    lines: [{ id: "line", amount: 101, taxRate: 10 }],
    taxConfig: YEN_HT,
    currency: "JPY",
  });
  assert.deepEqual(
    [calculation.subtotalExclTax, calculation.taxAmount, calculation.totalInclTax],
    [101, 10, 111],
  );
});

test("yen with tax included: the split is whole yen and adds up to the price", () => {
  const calculation = calculateTaxBreakdown({
    lines: [{ id: "line", amount: 101, taxRate: 10 }],
    taxConfig: YEN_TTC,
    currency: "JPY",
  });
  assert.deepEqual(
    [calculation.subtotalExclTax, calculation.taxAmount, calculation.totalInclTax],
    [92, 9, 101],
  );
});

test("a yen discount is split across lines in whole yen, and the lines' tax adds up", () => {
  const calculation = calculateTaxBreakdown({
    lines: [
      { id: "a", amount: 101, taxRate: 10 },
      { id: "b", amount: 203, taxRate: 10 },
      { id: "c", amount: 55, taxRate: 8 },
    ],
    discountAmount: 50,
    taxConfig: YEN_HT,
    currency: "JPY",
  });
  const discounts = calculation.lines.map((line) => line.discountAmount);
  assert.ok(discounts.every(Number.isInteger), JSON.stringify(discounts));
  assert.equal(
    discounts.reduce((sum, value) => sum + value, 0),
    50,
  );
  for (const line of calculation.lines) {
    assert.ok(Number.isInteger(line.taxAmount) && Number.isInteger(line.amountInclTax));
  }
  assert.equal(
    calculation.lines.reduce((sum, line) => sum + line.taxAmount, 0),
    calculation.taxAmount,
  );
  assert.ok(Number.isInteger(calculation.totalInclTax));
});

test("euro carts are computed exactly as without a currency, which is how they were computed", () => {
  // A small deterministic generator: the same carts on every run.
  let seed = 7;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const cents = (max: number) => Math.round(next() * max * 100) / 100;
  const rates = [null, 0, 5.5, 10, 20];
  for (let cart = 0; cart < 400; cart += 1) {
    const lines = Array.from({ length: 1 + Math.floor(next() * 5) }, (_, index) => ({
      id: `item:${index}`,
      amount: cents(500),
      taxRate: rates[Math.floor(next() * rates.length)]!,
    }));
    const input = {
      lines,
      deliveryFee: next() < 0.5 ? cents(40) : 0,
      discountAmount: next() < 0.5 ? cents(60) : 0,
      depositAmount: cents(300),
      taxConfig: {
        enabled: next() < 0.8,
        rate: [5.5, 10, 20][Math.floor(next() * 3)]!,
        displayMode: next() < 0.5 ? ("inclusive" as const) : ("exclusive" as const),
      },
    };
    assert.deepEqual(
      calculateTaxBreakdown({ ...input, currency: "EUR" }),
      calculateTaxBreakdown(input),
      `cart ${cart}`,
    );
  }
});

test("an amount is rounded in its currency's minor unit, on the decimal value as written", () => {
  assert.equal(roundToMinorUnit(0.015 * 3, "EUR"), 0.05);
  assert.equal(roundToMinorUnit(0.015, "EUR"), 0.02);
  assert.equal(roundToMinorUnit(1.005, "EUR"), 1.01);
  assert.equal(roundToMinorUnit(-0.045, "EUR"), -0.05);
  assert.equal(roundToMinorUnit(101.5, "JPY"), 102);
  assert.equal(roundToMinorUnit(12.34, "EUR"), 12.34);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateTaxBreakdown } from "./tax";

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

import assert from "node:assert/strict";
import { test } from "node:test";

import type { EditableItem } from "../types";
import { withTotalPriceCommitted, withUnitPriceCommitted } from "./editable-items";

// A line priced from its product, as the form reads it: two kayaks for two
// days, 32.00, shown at 8.00 a day.
const fromProduct: EditableItem = {
  id: "item-1",
  productId: "product-1",
  quantity: 2,
  consumedQuantity: 0,
  unitPrice: 16,
  depositPerUnit: 0,
  isManualPrice: false,
  pricingMode: "day",
  productSnapshot: { name: "Kayak", description: null, images: [] },
  product: null,
  stored: { quantity: 2, unitPrice: 16, totalPrice: 32, taxRate: null, pricingBreakdown: null },
};

test("a unit price committed as the field showed it types nothing", () => {
  assert.equal(
    withUnitPriceCommitted(fromProduct, { price: 8, shownUnitPrice: 8.004, pricingMode: "day" }),
    fromProduct,
  );
});

test("a price the field shows rounded down, committed as shown, types nothing", () => {
  // 10.70 over four days is 2.675 a day, which the field writes "2.67".
  assert.equal(
    withUnitPriceCommitted(fromProduct, {
      price: 2.67,
      shownUnitPrice: 10.7 / 4,
      pricingMode: "day",
    }),
    fromProduct,
  );
  assert.equal(
    withTotalPriceCommitted(fromProduct, {
      totalPrice: 0.61,
      shownTotalPrice: 0.615,
      pricingMode: "day",
      duration: 2,
    }),
    fromProduct,
  );
});

test("another unit price is typed, per period", () => {
  const typed = withUnitPriceCommitted(fromProduct, {
    price: 7.5,
    shownUnitPrice: 8,
    pricingMode: "day",
  });
  assert.equal(typed.isManualPrice, true);
  assert.equal(typed.unitPrice, 7.5);
});

test("a total committed as the field showed it types nothing", () => {
  assert.equal(
    withTotalPriceCommitted(fromProduct, {
      totalPrice: 32,
      shownTotalPrice: 32,
      pricingMode: "day",
      duration: 2,
    }),
    fromProduct,
  );
});

test("another total is typed, read back per period", () => {
  const typed = withTotalPriceCommitted(fromProduct, {
    totalPrice: 40,
    shownTotalPrice: 32,
    pricingMode: "day",
    duration: 2,
  });
  assert.equal(typed.isManualPrice, true);
  assert.equal(typed.unitPrice, 10);
});

test("a typed price committed unchanged stays typed, at its price", () => {
  const typed = { ...fromProduct, isManualPrice: true, unitPrice: 7.5, stored: null };
  assert.equal(
    withUnitPriceCommitted(typed, { price: 7.5, shownUnitPrice: 7.5, pricingMode: "day" }),
    typed,
  );
});

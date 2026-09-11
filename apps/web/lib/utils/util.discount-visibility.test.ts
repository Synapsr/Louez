import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getDisplayableMaxDiscount,
  getDisplayableSavings,
  getEffectiveDiscountPercent,
  isDiscountDisplayable,
} from "./util.discount-visibility";

describe("isDiscountDisplayable", () => {
  test("hides a missing or zero discount", () => {
    assert.equal(isDiscountDisplayable(null, null), false);
    assert.equal(isDiscountDisplayable(0, 50), false);
  });

  test("shows any discount when the cap is disabled", () => {
    assert.equal(isDiscountDisplayable(80, null), true);
    assert.equal(isDiscountDisplayable(80, undefined), true);
  });

  test("hides discounts above the cap and keeps those at or below it", () => {
    assert.equal(isDiscountDisplayable(37.5, 5), false);
    assert.equal(isDiscountDisplayable(5, 5), true);
    assert.equal(isDiscountDisplayable(4, 5), true);
  });
});

describe("getEffectiveDiscountPercent", () => {
  test("prefers the explicit tier percentage", () => {
    assert.equal(
      getEffectiveDiscountPercent({ discountPercent: 12, savings: 100, originalSubtotal: 200 }),
      12,
    );
  });

  test("does not turn an ordinary price comparison into a discount", () => {
    assert.equal(
      getEffectiveDiscountPercent({ discountPercent: null, savings: 105, originalSubtotal: 280 }),
      0,
    );
    assert.equal(
      getEffectiveDiscountPercent({ discountPercent: null, savings: 0, originalSubtotal: 280 }),
      0,
    );
  });
});

describe("getDisplayableSavings", () => {
  const capped = { subtotal: 175, originalSubtotal: 280, savings: 105, discountPercent: 37.5 };
  const small = { subtotal: 95, originalSubtotal: 100, savings: 5, discountPercent: 5 };

  test("keeps every line when the cap is disabled", () => {
    assert.deepEqual(getDisplayableSavings([capped, small], null), {
      savings: 110,
      originalSubtotal: 380,
    });
  });

  test("folds hidden discounts into the list price", () => {
    assert.deepEqual(getDisplayableSavings([capped, small], 5), {
      savings: 5,
      originalSubtotal: 275,
    });
  });

  test("reports no savings when every line is hidden", () => {
    assert.deepEqual(getDisplayableSavings([capped], 5), { savings: 0, originalSubtotal: 175 });
  });
});

describe("getDisplayableMaxDiscount", () => {
  const summary = { maxReductionPercent: 30, allReductionPercents: [10, 20, 30] };

  test("shows the highest discount when the cap is disabled", () => {
    assert.equal(getDisplayableMaxDiscount(summary, null), 30);
    assert.equal(getDisplayableMaxDiscount(summary, undefined), 30);
  });

  test("shows the highest discount at or below the cap", () => {
    assert.equal(getDisplayableMaxDiscount(summary, 20), 20);
    assert.equal(getDisplayableMaxDiscount(summary, 15), 10);
  });

  test("shows nothing when every discount is above the cap or there is none", () => {
    assert.equal(getDisplayableMaxDiscount(summary, 5), 0);
    assert.equal(
      getDisplayableMaxDiscount({ maxReductionPercent: 0, allReductionPercents: [] }, null),
      0,
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calculateRateBasedPrice } from "./calculate";
import { calculateSeasonalAwarePrice } from "./seasonal";

const weekly = { basePrice: 15, basePeriodMinutes: 10080, deposit: 0, rates: [] };

describe("rate pricing references", () => {
  test("a single progressive rate does not advertise proration as a discount", () => {
    for (const quantity of [1, 3, 7]) {
      const result = calculateRateBasedPrice(
        { ...weekly, enforceStrictTiers: false },
        20280,
        quantity,
      );
      assert.equal(result.subtotal, Math.round(30.18 * quantity * 100) / 100);
      assert.equal(result.originalSubtotal, result.subtotal);
      assert.equal(result.savings, 0);
      assert.equal(result.reductionPercent, null);
    }
  });

  test("the base period is the minimum in both modes", () => {
    for (const enforceStrictTiers of [true, false]) {
      for (const duration of [1, 1440, 10080]) {
        const result = calculateRateBasedPrice({ ...weekly, enforceStrictTiers }, duration, 1);
        assert.equal(result.subtotal, 15);
        assert.equal(result.originalSubtotal, 15);
        assert.equal(result.savings, 0);
      }
    }
  });

  test("strict single-rate pricing still charges three started weeks", () => {
    const result = calculateRateBasedPrice({ ...weekly, enforceStrictTiers: true }, 20280, 1);
    assert.equal(result.subtotal, 45);
    assert.equal(result.originalSubtotal, 45);
    assert.equal(result.savings, 0);
  });

  test("an omitted mode preserves legacy progressive pricing", () => {
    const result = calculateRateBasedPrice(weekly, 11520, 1);
    assert.equal(result.subtotal, 17.14);
    assert.equal(result.originalSubtotal, 17.14);
  });

  test("a discounted tier compares against the prorated base rate", () => {
    const result = calculateRateBasedPrice(
      {
        basePrice: 20,
        basePeriodMinutes: 240,
        deposit: 0,
        enforceStrictTiers: false,
        rates: [{ id: "day", period: 1440, price: 50, displayOrder: 0 }],
      },
      750,
      2,
    );
    assert.equal(result.subtotal, 65.5);
    assert.equal(result.originalSubtotal, 125);
    assert.equal(result.savings, 59.5);
    assert.equal(result.reductionPercent, 47.6);
  });

  test("an additional rate at the same effective price creates no discount", () => {
    const result = calculateRateBasedPrice(
      {
        ...weekly,
        enforceStrictTiers: false,
        rates: [{ id: "fortnight", period: 20160, price: 30, displayOrder: 0 }],
      },
      11520,
      1,
    );
    assert.equal(result.subtotal, 17.14);
    assert.equal(result.savings, 0);
  });

  test("seasonal proration without discounted rates also has no savings", () => {
    const result = calculateSeasonalAwarePrice(
      {
        ...weekly,
        pricingMode: "week",
        tiers: [],
        enforceStrictTiers: false,
      },
      [
        {
          id: "summer",
          name: "Summer",
          startDate: "2026-07-01",
          endDate: "2026-07-31",
          basePrice: 21,
          rates: [],
          tiers: [],
        },
      ],
      new Date(2026, 6, 1, 10),
      new Date(2026, 6, 15, 12),
      3,
    );
    assert.equal(result.subtotal, 126.75);
    assert.equal(result.originalSubtotal, result.subtotal);
    assert.equal(result.savings, 0);
  });
});

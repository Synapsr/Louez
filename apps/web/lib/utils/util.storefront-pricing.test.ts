import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getStorefrontPricingSummary,
  getStorefrontRateRows,
} from "@/lib/utils/util.storefront-pricing";

describe("getStorefrontRateRows", () => {
  test("shows a stored copy of the base rate only once", () => {
    const rows = getStorefrontRateRows({
      price: "25.00",
      pricingMode: "day",
      basePeriodMinutes: 1440,
      pricingTiers: [
        { id: "base-copy", period: 1440, price: "25,00", minDuration: null, discountPercent: null },
        { id: "three-days", period: 4320, price: "60", minDuration: null, discountPercent: null },
        { id: "week", period: 10080, price: "110", minDuration: null, discountPercent: null },
        {
          id: "week-copy",
          period: 10080,
          price: "110.000000",
          minDuration: null,
          discountPercent: null,
        },
      ],
    });

    assert.deepEqual(rows, [
      { id: "__base__", periodMinutes: 1440, price: 25, reductionPercent: 0 },
      { id: "three-days", periodMinutes: 4320, price: 60, reductionPercent: 0 },
      { id: "week", periodMinutes: 10080, price: 110, reductionPercent: 0 },
    ]);
  });

  test("a legacy zero-discount tier does not create a redundant rates card", () => {
    assert.deepEqual(
      getStorefrontRateRows({
        price: "20",
        pricingMode: "day",
        pricingTiers: [{ id: "base-copy", minDuration: 1, discountPercent: "0" }],
      }),
      [{ id: "__base__", periodMinutes: 1440, price: 20, reductionPercent: 0 }],
    );
  });

  test("deduplicates identical legacy discounts", () => {
    const rows = getStorefrontRateRows({
      price: "20",
      pricingMode: "day",
      pricingTiers: [
        { id: "three-days", minDuration: 3, discountPercent: "20" },
        { id: "three-days-copy", minDuration: 3, discountPercent: "20.00" },
      ],
    });
    assert.deepEqual(
      rows.map((row) => row.id),
      ["__base__", "three-days"],
    );
  });

  test("preserves different prices for the same duration and equal prices for different durations", () => {
    const rows = getStorefrontRateRows({
      price: "25",
      basePeriodMinutes: 1440,
      pricingTiers: [
        {
          id: "same-duration",
          period: 1440,
          price: "20",
          minDuration: null,
          discountPercent: null,
        },
        { id: "same-price", period: 2880, price: "25", minDuration: null, discountPercent: null },
      ],
    });
    assert.deepEqual(
      rows.map((row) => row.id),
      ["same-duration", "__base__", "same-price"],
    );
  });

  test("turns duration tiers into rows priced for the whole tier period", () => {
    assert.deepEqual(
      getStorefrontRateRows({
        price: "20",
        pricingMode: "day",
        pricingTiers: [
          { id: "t7", minDuration: 7, discountPercent: "20" },
          { id: "t3", minDuration: 3, discountPercent: "12,5" },
          { id: "skipped", minDuration: null, discountPercent: "50" },
        ],
      }),
      [
        { id: "__base__", periodMinutes: 1440, price: 20, reductionPercent: 0 },
        { id: "t3", periodMinutes: 4320, price: 52.5, reductionPercent: 12.5 },
        { id: "t7", periodMinutes: 10080, price: 112, reductionPercent: 20 },
      ],
    );
  });

  test("shows ordinary duration rates without advertising a discount", () => {
    assert.deepEqual(
      getStorefrontRateRows({
        price: "20",
        pricingMode: "hour",
        basePeriodMinutes: 240,
        pricingTiers: [
          { id: "day", minDuration: null, discountPercent: null, period: 1440, price: "60" },
          { id: "dearer", minDuration: null, discountPercent: null, period: 120, price: "15" },
          { id: "skipped", minDuration: null, discountPercent: null, period: null, price: "5" },
        ],
      }),
      [
        { id: "dearer", periodMinutes: 120, price: 15, reductionPercent: 0 },
        { id: "__base__", periodMinutes: 240, price: 20, reductionPercent: 0 },
        { id: "day", periodMinutes: 1440, price: 60, reductionPercent: 0 },
      ],
    );
  });

  test("a forfait has no grid", () => {
    assert.deepEqual(
      getStorefrontRateRows({
        price: "80",
        pricingKind: "fixed",
        pricingTiers: [{ id: "t1", minDuration: 3, discountPercent: "10" }],
      }),
      [],
    );
  });
});

describe("getStorefrontPricingSummary", () => {
  test("shows the base rate and every discount a longer rental unlocks", () => {
    const summary = getStorefrontPricingSummary({
      price: "20",
      pricingMode: "week",
      pricingTiers: [
        { id: "t2", minDuration: 2, discountPercent: "10" },
        { id: "t4", minDuration: 4, discountPercent: "25" },
      ],
    });

    assert.deepEqual(summary, {
      pricingKind: "duration",
      displayPrice: 20,
      displayPeriodMinutes: 10080,
      maxReductionPercent: 25,
      allReductionPercents: [10, 25],
    });
    assert.equal("showStartingFrom" in summary, false);
  });

  test("a forfait shows its price without a period or discount", () => {
    assert.deepEqual(
      getStorefrontPricingSummary({ price: "80,5", pricingKind: "fixed", pricingMode: "day" }),
      {
        pricingKind: "fixed",
        displayPrice: 80.5,
        displayPeriodMinutes: null,
        maxReductionPercent: 0,
        allReductionPercents: [],
      },
    );
  });
});

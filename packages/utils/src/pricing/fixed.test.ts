import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateFixedPrice, calculateRentalPrice, calculateSeasonalAwarePrice } from "./index";

test("fixed pricing multiplies the unit price by quantity only", () => {
  const result = calculateFixedPrice(
    {
      basePrice: 15,
      deposit: 50,
      pricingMode: "day",
    },
    3,
  );

  assert.equal(result.subtotal, 45);
  assert.equal(result.deposit, 150);
  assert.equal(result.total, 195);
});

test("fixed pricing is independent of rental duration and seasonal pricing", () => {
  const product = {
    basePrice: 15,
    basePeriodMinutes: null,
    deposit: 0,
    pricingKind: "fixed",
    pricingMode: "day",
    enforceStrictTiers: true,
    tiers: [{ id: "ignored", minDuration: 2, discountPercent: 50 }],
    rates: [{ id: "ignored", price: 1, period: 60, displayOrder: 0 }],
  } satisfies Parameters<typeof calculateSeasonalAwarePrice>[0];
  const seasonalPricings = [
    {
      id: "ignored",
      name: "Ignored seasonal price",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      basePrice: 999,
      tiers: [],
      rates: [],
    },
  ];

  const oneHour = calculateSeasonalAwarePrice(
    product,
    seasonalPricings,
    "2026-08-24T10:00:00.000Z",
    "2026-08-24T11:00:00.000Z",
    2,
  );
  const thirtyDays = calculateSeasonalAwarePrice(
    product,
    seasonalPricings,
    "2026-08-01T10:00:00.000Z",
    "2026-08-31T10:00:00.000Z",
    2,
  );

  assert.equal(oneHour.subtotal, 30);
  assert.equal(thirtyDays.subtotal, 30);
  assert.equal(thirtyDays.isSeasonal, false);
});

test("fixed pricing returns the canonical breakdown", () => {
  const result = calculateFixedPrice(
    {
      basePrice: 15,
      deposit: 0,
      pricingMode: "day",
    },
    2,
  );

  assert.deepEqual(result.breakdown, {
    basePrice: 15,
    effectivePrice: 15,
    duration: 1,
    pricingMode: "day",
    pricingKind: "fixed",
    discountPercent: 0,
    discountAmount: 0,
    tierApplied: null,
    taxRate: null,
    taxAmount: null,
    subtotalExclTax: null,
    subtotalInclTax: null,
  });
  assert.equal("appliedRates" in result.breakdown, false);
  assert.equal("seasonalSegments" in result.breakdown, false);
});

test("duration pricing keeps the existing simple calculation", () => {
  const result = calculateRentalPrice(
    {
      basePrice: 10,
      deposit: 20,
      pricingKind: "duration",
      pricingMode: "day",
      tiers: [],
    },
    3,
    2,
  );

  assert.equal(result.subtotal, 60);
  assert.equal(result.deposit, 40);
  assert.equal(result.total, 100);
  assert.equal(result.duration, 3);
  assert.equal(result.discountPercent, null);
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calculateDuration } from "@louez/utils";

import type { StorefrontProductPricing } from "@/lib/storefront/storefront.types";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import {
  getStorefrontProductPrice,
  normalizeStorefrontTiers,
  parseStorefrontDecimal,
  toCartItemForPricing,
} from "@/lib/utils/util.storefront-product-pricing";

/** Both paths must agree: this is the parity the storefront relies on. */
const assertParityWithCart = (
  product: StorefrontProductPricing,
  startDate: Date | string | null,
  endDate: Date | string | null,
  quantity: number,
) => {
  const input = { product, startDate, endDate, quantity };
  const fromDisplay = getStorefrontProductPrice(input);
  const fromCart = calculateCartItemPrice(toCartItemForPricing(input), null, null);
  assert.deepEqual(fromDisplay, fromCart);
  return fromDisplay;
};

describe("parseStorefrontDecimal", () => {
  test("reads numbers, decimal strings and decimal-comma strings", () => {
    assert.equal(parseStorefrontDecimal(12.5), 12.5);
    assert.equal(parseStorefrontDecimal("12.500000"), 12.5);
    assert.equal(parseStorefrontDecimal(" 12,5 "), 12.5);
  });

  test("never yields NaN", () => {
    assert.equal(parseStorefrontDecimal(""), null);
    assert.equal(parseStorefrontDecimal("abc"), null);
    assert.equal(parseStorefrontDecimal(null), null);
    assert.equal(parseStorefrontDecimal(undefined), null);
    assert.equal(parseStorefrontDecimal(Number.NaN), null);
  });
});

describe("normalizeStorefrontTiers", () => {
  test("parses decimals, keeps periods and reads a NULL minDuration as 1", () => {
    assert.deepEqual(
      normalizeStorefrontTiers([
        { id: "t1", minDuration: 3, discountPercent: "10.000000" },
        { id: "t2", minDuration: null, discountPercent: "12,5", period: 1440, price: "50,00" },
        { id: "t3", minDuration: 7, discountPercent: null, period: null, price: null },
      ]),
      [
        { id: "t1", minDuration: 3, discountPercent: 10, period: null, price: null },
        { id: "t2", minDuration: 1, discountPercent: 12.5, period: 1440, price: 50 },
        { id: "t3", minDuration: 7, discountPercent: 0, period: null, price: null },
      ],
    );
  });

  test("yields an empty list without tiers", () => {
    assert.deepEqual(normalizeStorefrontTiers(undefined), []);
    assert.deepEqual(normalizeStorefrontTiers(null), []);
  });
});

describe("getStorefrontProductPrice", () => {
  test("fixed pricing: price times quantity, dates and tiers ignored, comma accepted", () => {
    const result = assertParityWithCart(
      {
        price: "45,50",
        pricingKind: "fixed",
        pricingMode: "day",
        pricingTiers: [{ id: "t1", minDuration: 2, discountPercent: "50" }],
      },
      "2026-08-01T09:00:00.000Z",
      "2026-08-05T09:00:00.000Z",
      3,
    );

    assert.deepEqual(result, {
      subtotal: 136.5,
      originalSubtotal: 136.5,
      savings: 0,
      discountPercent: 0,
    });
  });

  test("duration pricing with legacy tiers applies the best reached tier, quantity > 1", () => {
    const result = assertParityWithCart(
      {
        price: "20",
        pricingMode: "day",
        pricingTiers: [
          { id: "t7", minDuration: 7, discountPercent: "20" },
          { id: "t3", minDuration: 3, discountPercent: "10.000000" },
        ],
      },
      "2026-08-01T09:00:00.000Z",
      "2026-08-05T09:00:00.000Z",
      2,
    );

    assert.deepEqual(result, {
      subtotal: 144,
      originalSubtotal: 160,
      savings: 16,
      discountPercent: 10,
    });
  });

  test("a NULL minDuration tier applies from the first period, as on the server", () => {
    const result = assertParityWithCart(
      {
        price: "100",
        pricingMode: "day",
        pricingTiers: [{ id: "t1", minDuration: null, discountPercent: "5" }],
      },
      "2026-08-01T09:00:00.000Z",
      "2026-08-03T09:00:00.000Z",
      1,
    );

    assert.deepEqual(result, {
      subtotal: 190,
      originalSubtotal: 200,
      savings: 10,
      discountPercent: 5,
    });
  });

  test("a started period is billed in full: 2 days and 5 hours cost 3 days", () => {
    const startDate = "2026-08-01T09:00:00.000Z";
    const endDate = "2026-08-03T14:00:00.000Z";

    assert.equal(calculateDuration(startDate, endDate, "day"), 3);

    const result = assertParityWithCart({ price: "20", pricingMode: "day" }, startDate, endDate, 1);

    assert.deepEqual(result, {
      subtotal: 60,
      originalSubtotal: 60,
      savings: 0,
      discountPercent: null,
    });
  });

  test("rate-based progressive pricing interpolates between the base rate and the next tier", () => {
    const result = assertParityWithCart(
      {
        price: "20",
        pricingMode: "hour",
        basePeriodMinutes: 240,
        enforceStrictTiers: false,
        pricingTiers: [
          { id: "r1", minDuration: null, discountPercent: null, period: 1440, price: "50" },
        ],
      },
      "2026-08-01T08:00:00.000Z",
      "2026-08-01T20:00:00.000Z",
      1,
    );

    assert.deepEqual(result, {
      subtotal: 32,
      originalSubtotal: 60,
      savings: 28,
      discountPercent: 46.67,
    });
  });

  test("rate-based strict pricing snaps up to the next tier", () => {
    const result = assertParityWithCart(
      {
        price: "20",
        pricingMode: "hour",
        basePeriodMinutes: 240,
        enforceStrictTiers: true,
        pricingTiers: [
          { id: "r1", minDuration: null, discountPercent: null, period: 1440, price: "50" },
        ],
      },
      "2026-08-01T08:00:00.000Z",
      "2026-08-01T20:00:00.000Z",
      1,
    );

    assert.deepEqual(result, {
      subtotal: 50,
      originalSubtotal: 60,
      savings: 10,
      discountPercent: 16.67,
    });
  });

  test("seasonal pricing splits the rental by season and sums the segments", () => {
    // Local dates: the seasonal splitter works on calendar days in the runtime zone.
    const startDate = new Date(2026, 5, 30, 10, 0, 0);
    const endDate = new Date(2026, 6, 2, 10, 0, 0);

    const result = assertParityWithCart(
      {
        price: "10",
        pricingMode: "day",
        seasonalPricings: [
          {
            id: "summer",
            name: "Summer",
            startDate: "2026-07-01",
            endDate: "2026-07-31",
            basePrice: 15,
            tiers: [],
            rates: [],
          },
        ],
      },
      startDate,
      endDate,
      1,
    );

    // 30 June 10:00 -> 1 July 00:00 = 1 base day (10), 1 July -> 2 July 10:00 = 2 season days (30).
    assert.deepEqual(result, {
      subtotal: 40,
      originalSubtotal: 40,
      savings: 0,
      discountPercent: null,
    });
  });

  test("without dates it is the base price times the quantity", () => {
    const result = assertParityWithCart(
      {
        price: "12,50",
        pricingMode: "day",
        pricingTiers: [{ id: "t1", minDuration: 3, discountPercent: "10" }],
      },
      null,
      null,
      4,
    );

    assert.deepEqual(result, {
      subtotal: 50,
      originalSubtotal: 50,
      savings: 0,
      discountPercent: null,
    });
  });
});

describe("toCartItemForPricing", () => {
  test("keeps the flags the server prices with and drops empty seasonal lists", () => {
    const item = toCartItemForPricing({
      product: {
        price: "30",
        deposit: "100,00",
        pricingKind: null,
        pricingMode: null,
        basePeriodMinutes: 60,
        enforceStrictTiers: true,
        pricingTiers: [
          { id: "r1", minDuration: null, discountPercent: null, period: 1440, price: "200" },
        ],
        seasonalPricings: [],
      },
      startDate: new Date("2026-08-01T09:00:00.000Z"),
      endDate: "2026-08-02T09:00:00.000Z",
      quantity: 2,
    });

    assert.deepEqual(item, {
      price: 30,
      deposit: 100,
      quantity: 2,
      startDate: "2026-08-01T09:00:00.000Z",
      endDate: "2026-08-02T09:00:00.000Z",
      pricingMode: "day",
      pricingKind: "duration",
      productPricingMode: null,
      basePeriodMinutes: 60,
      enforceStrictTiers: true,
      pricingTiers: [{ id: "r1", minDuration: 1, discountPercent: 0, period: 1440, price: 200 }],
      seasonalPricings: undefined,
    });
  });
});

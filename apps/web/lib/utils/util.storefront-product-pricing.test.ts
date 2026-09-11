import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { calculateDuration } from "@louez/utils";

import type { StorefrontProductPricing } from "@/lib/storefront/storefront.types";
import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import {
  getDisplayableSavings,
  getEffectiveDiscountPercent,
} from "@/lib/utils/util.discount-visibility";
import { getStorefrontPricingSummary } from "@/lib/utils/util.storefront-pricing";
import {
  getStorefrontProductPrice,
  getStorefrontBillingDetail,
  isStorefrontPriceProrated,
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

describe("ordinary duration prices", () => {
  const wingfoil: StorefrontProductPricing = {
    price: 55,
    deposit: 1200,
    basePeriodMinutes: 240,
    enforceStrictTiers: true,
    pricingTiers: [
      { id: "8h", period: 480, price: 88, minDuration: null, discountPercent: null },
      { id: "day", period: 1440, price: 116, minDuration: null, discountPercent: null },
      { id: "2days", period: 2880, price: 198, minDuration: null, discountPercent: null },
      { id: "week", period: 10080, price: 550, minDuration: null, discountPercent: null },
    ],
  };
  const startDate = "2026-09-15T07:00:00Z";
  const endDate = "2026-09-17T16:00:00Z";
  const quote = (product: StorefrontProductPricing, end = endDate) => {
    const input = { product, startDate, endDate: end, timezone: "Europe/Paris" };
    const result = getStorefrontProductPrice(input);
    return { result, detail: getStorefrontBillingDetail(toCartItemForPricing(input), result) };
  };

  test("the wingfoil week costs 550 without an advertised 33 percent discount", () => {
    const { result, detail } = quote(wingfoil);
    assert.equal(result.subtotal, 550);
    assert.equal(result.originalSubtotal, 825);
    assert.equal(result.savings, 275);
    assert.equal(getEffectiveDiscountPercent(result), 0);
    assert.deepEqual(getDisplayableSavings([result], null), { originalSubtotal: 550, savings: 0 });
    assert.equal(getStorefrontPricingSummary(wingfoil).maxReductionPercent, 0);
    assert.deepEqual(detail, { mode: "package", periodMinutes: 10080, count: 1 });
  });

  test("both an inactive season and an active season keep their ordinary rates", () => {
    for (const start of ["2026-07-01", "2026-09-01"]) {
      const { result, detail } = quote({
        ...wingfoil,
        seasonalPricings: [
          {
            id: "summer",
            name: "Summer",
            startDate: start,
            endDate: start === "2026-07-01" ? "2026-08-31" : "2026-09-30",
            basePrice: 70,
            tiers: [],
            rates: [{ id: "week", period: 10080, price: 700, displayOrder: 0 }],
          },
        ],
      });
      assert.equal(result.subtotal, start === "2026-07-01" ? 550 : 700);
      assert.equal(getEffectiveDiscountPercent(result), 0);
      assert.deepEqual(detail, { mode: "package", periodMinutes: 10080, count: 1 });
    }
  });

  test("progressive grids describe duration pricing and keep exact tier rates", () => {
    const progressive = { ...wingfoil, enforceStrictTiers: false };
    assert.deepEqual(quote(progressive).detail, { mode: "prorated" });
    assert.equal(quote(progressive).result.discountPercent, null);
    assert.deepEqual(quote(progressive, "2026-09-17T07:00:00Z").detail, {
      mode: "rate",
      periodMinutes: 2880,
    });
    assert.deepEqual(quote(progressive, "2026-09-15T08:00:00Z").detail, {
      mode: "rate",
      periodMinutes: 240,
    });
  });

  test("repeated packages use the engine count and cart dates take precedence", () => {
    const { detail } = quote(wingfoil, "2026-09-23T07:00:00Z");
    assert.deepEqual(detail, { mode: "package", periodMinutes: 10080, count: 2 });
    const input = { product: wingfoil, startDate, endDate };
    const item = toCartItemForPricing(input);
    const result = calculateCartItemPrice(item, startDate, "2026-09-16T07:00:00Z");
    assert.deepEqual(getStorefrontBillingDetail(item, result, startDate, "2026-09-16T07:00:00Z"), {
      mode: "package",
      periodMinutes: 1440,
      count: 1,
    });
  });

  test("mixed seasons use their existing split instead of one misleading package label", () => {
    const { result, detail } = quote({
      ...wingfoil,
      seasonalPricings: [
        {
          id: "autumn",
          name: "Autumn",
          startDate: "2026-09-16",
          endDate: "2026-09-30",
          basePrice: 70,
          rates: [],
          tiers: [],
        },
      ],
    });
    assert.equal(result.seasonalSegments?.length, 2);
    assert.equal(result.discountPercent, null);
    assert.equal(detail, null);
  });

  test("an explicit legacy discount still contributes to displayed savings", () => {
    const { result, detail } = quote({
      price: 100,
      pricingMode: "day",
      basePeriodMinutes: null,
      pricingTiers: [{ id: "10off", minDuration: 2, discountPercent: 10 }],
    });
    assert.equal(getEffectiveDiscountPercent(result), 10);
    assert.deepEqual(getDisplayableSavings([result, quote(wingfoil).result], null), {
      originalSubtotal: 850,
      savings: 30,
    });
    assert.equal(detail, null);
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
  test("weekly proration agrees with the cart without a fictitious discount", () => {
    const product = { price: "15", basePeriodMinutes: 10080, enforceStrictTiers: false };
    const startDate = "2026-09-11T14:30:00Z";
    const endDate = "2026-09-25T16:30:00Z";
    const result = assertParityWithCart(product, startDate, endDate, 1);
    assert.deepEqual(result, {
      subtotal: 30.18,
      originalSubtotal: 30.18,
      savings: 0,
      discountPercent: null,
    });
    assert.equal(isStorefrontPriceProrated({ product, startDate, endDate }), true);
    assert.equal(
      isStorefrontPriceProrated({
        product: { ...product, enforceStrictTiers: true },
        startDate,
        endDate,
      }),
      false,
    );
    assert.equal(
      isStorefrontPriceProrated({ product, startDate, endDate: "2026-09-12T14:30:00Z" }),
      false,
    );
    assert.equal(
      isStorefrontPriceProrated({ product, startDate, endDate: "2026-09-25T14:30:00Z" }),
      false,
    );
    assert.equal(
      isStorefrontPriceProrated({
        product: { ...product, pricingKind: "fixed" },
        startDate,
        endDate,
      }),
      false,
    );
    assert.equal(isStorefrontPriceProrated({ product }), false);
  });

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
      discountPercent: null,
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
      discountPercent: null,
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

    // Two days total: 14 hours at the base rate, 34 hours at the summer rate.
    const { seasonalSegments, ...totals } = result;
    assert.deepEqual(
      seasonalSegments?.map((segment) => segment.subtotal),
      [5.83, 21.25],
    );
    assert.deepEqual(totals, {
      subtotal: 27.08,
      originalSubtotal: 27.08,
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

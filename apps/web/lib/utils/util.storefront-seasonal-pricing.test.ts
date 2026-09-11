import assert from "node:assert/strict";
import { test } from "node:test";
import type { StorefrontProductPricing } from "@/lib/storefront/storefront.types";
import {
  formatSeasonDateRange,
  getStorefrontSeasonalRates,
  getSeasonalCalendarPricing,
  getSeasonalDurationParts,
  getSeasonalHeadline,
  getSeasonalPriceShares,
  getSeasonToneMap,
  getVisibleSeasonalPricing,
} from "./util.storefront-seasonal-pricing";
import { getStorefrontProductPrice } from "./util.storefront-product-pricing";
import { priceCatalogLine, type PricingCatalogProduct } from "@louez/api/services/pricing-catalog";

const product = {
  price: "25",
  deposit: "100",
  pricingKind: "duration",
  pricingMode: "day",
  basePeriodMinutes: 1440,
  enforceStrictTiers: false,
  pricingTiers: [],
  seasonalPricings: [
    {
      id: "summer",
      name: "Summer",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      basePrice: 40,
      tiers: [],
      rates: [],
    },
  ],
} satisfies StorefrontProductPricing;

test("season dates use stable spaces across server and browser Intl implementations", () => {
  assert.equal(formatSeasonDateRange("2026-09-12", "2026-10-07", "en-GB"), "12 Sept – 7 Oct 2026");
  for (const locale of ["fr", "en-GB", "de", "es", "it", "nl", "pl", "pt"]) {
    assert.doesNotMatch(formatSeasonDateRange("2026-09-12", "2026-10-07", locale), /[^\S ]/);
  }
});

test("single-rate seasons remain available for comparison and the calendar", () => {
  const rows = getStorefrontSeasonalRates(product);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.rows.map((rate) => rate.price)),
    [[25], [40]],
  );
  assert.equal(getSeasonalCalendarPricing(product)?.periodMinutes, 1440);
});

test("seasonal duration grids retain their own rates and remove base duplicates", () => {
  const rows = getStorefrontSeasonalRates({
    ...product,
    seasonalPricings: [
      {
        ...product.seasonalPricings[0],
        rates: [
          { id: "base-copy", period: 1440, price: 40, displayOrder: 0 },
          { id: "week", period: 10080, price: 210, displayOrder: 1 },
        ],
      },
    ],
  });
  assert.deepEqual(
    rows[1].rows.map((rate) => rate.price),
    [40, 210],
  );
  assert.equal(rows[1].rows[1].reductionPercent, 0);
});

test("fixed pricing has no season grid or calendar legend", () => {
  assert.deepEqual(getStorefrontSeasonalRates({ ...product, pricingKind: "fixed" }), []);
  assert.equal(getSeasonalCalendarPricing({ ...product, pricingKind: "fixed" }), undefined);
});

test("season durations retain days, hours and minutes without huge minute counts", () => {
  assert.deepEqual(getSeasonalDurationParts(19830), [18720, 1080, 30]);
});

test("product, cart adapter and server quote agree at a store timezone season boundary", () => {
  const period = {
    startDate: "2026-06-30T10:00:00Z",
    endDate: "2026-07-01T10:00:00Z",
    timezone: "Europe/Paris",
  };
  const display = getStorefrontProductPrice({ product, ...period, quantity: 2 });
  const catalogProduct = {
    id: "product",
    name: "Product",
    description: null,
    images: [],
    price: 25,
    deposit: 100,
    pricingKind: "duration",
    pricingMode: "day",
    basePeriodMinutes: 1440,
    enforceStrictTiers: false,
    stockKind: "returnable",
    quantity: 10,
    trackUnits: false,
    bookingAttributeAxes: null,
    taxSettings: null,
    rates: [],
    tiers: [],
    seasonalPricings: product.seasonalPricings,
    timezone: period.timezone,
  } satisfies PricingCatalogProduct;
  const server = priceCatalogLine(catalogProduct, { ...period, productId: "product", quantity: 2 });
  assert.equal(display.subtotal, 65);
  assert.equal(server.subtotal, display.subtotal);
  assert.deepEqual(
    display.seasonalSegments?.map((segment) => segment.subtotal),
    [25, 40],
  );
  assert.equal(server.savings, 0);
  const atMidnight = getStorefrontProductPrice({
    product,
    ...period,
    endDate: "2026-06-30T22:00:00Z",
  });
  assert.equal(atMidnight.subtotal, 25);
  assert.equal(atMidnight.seasonalSegments, undefined);
});

test("calendar legend follows the visible months and includes season boundaries", () => {
  const pricing = getSeasonalCalendarPricing(product);
  assert.equal(getVisibleSeasonalPricing(pricing, new Date(2026, 5, 1), 1)?.seasons.length, 0);
  assert.equal(getVisibleSeasonalPricing(pricing, new Date(2026, 5, 1), 2)?.seasons.length, 1);
  assert.equal(getVisibleSeasonalPricing(pricing, new Date(2026, 7, 1), 1)?.seasons.length, 0);
});

test("headline identifies one season and uses the rental amount when seasons are mixed", () => {
  const selected = getStorefrontProductPrice({
    product,
    startDate: new Date(2026, 6, 1),
    endDate: new Date(2026, 6, 2),
  });
  assert.deepEqual(getSeasonalHeadline(product, selected.seasonalSegments, selected.subtotal), {
    amount: 40,
    mode: "season",
    seasonName: "Summer",
  });
  const mixed = getStorefrontProductPrice({
    product,
    startDate: new Date(2026, 5, 30),
    endDate: new Date(2026, 6, 2),
  });
  assert.deepEqual(getSeasonalHeadline(product, mixed.seasonalSegments, mixed.subtotal), {
    amount: 65,
    mode: "period",
  });
});

test("the from price excludes expired seasons", () => {
  const pricing = {
    ...product,
    seasonalPricings: [
      {
        ...product.seasonalPricings[0],
        basePrice: 1,
        startDate: "1900-01-01",
        endDate: "1900-12-31",
      },
      {
        ...product.seasonalPricings[0],
        basePrice: 15,
        startDate: "2099-01-01",
        endDate: "2099-12-31",
      },
    ],
  };
  assert.deepEqual(getSeasonalHeadline(pricing, undefined, undefined), {
    amount: 15,
    mode: "from",
  });
});

test("a rental that leaves a season and comes back lists that season once", () => {
  const segment = {
    startDate: new Date(2026, 5, 30),
    endDate: new Date(2026, 6, 1),
    durationMinutes: 1440,
    originalSubtotal: 25,
    savings: 0,
  };
  const shares = getSeasonalPriceShares(
    [
      { ...segment, seasonalPricingId: null, seasonalPricingName: null, subtotal: 25 },
      { ...segment, seasonalPricingId: "summer", seasonalPricingName: "Summer", subtotal: 40 },
      { ...segment, seasonalPricingId: null, seasonalPricingName: null, subtotal: 25 },
    ],
    getSeasonToneMap(product.seasonalPricings),
  );
  assert.deepEqual(shares, [
    { id: "base", name: null, toneIndex: null, subtotal: 50 },
    { id: "summer", name: "Summer", toneIndex: 0, subtotal: 40 },
  ]);
});

test("seasons keep their colour rank whether or not the product is at hand", () => {
  const seasons = [
    {
      ...product.seasonalPricings[0],
      id: "autumn",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    },
    product.seasonalPricings[0],
  ];
  assert.deepEqual(
    [...getSeasonToneMap(seasons)],
    [
      ["summer", 0],
      ["autumn", 1],
    ],
  );
  assert.deepEqual(
    getSeasonalCalendarPricing({ ...product, seasonalPricings: seasons })?.seasons.map(
      (season) => season.toneIndex,
    ),
    [0, 1],
  );
});

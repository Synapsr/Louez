import assert from "node:assert/strict";
import { test } from "node:test";
import { FieldApi, FormApi, revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";
import {
  buildStripeLineItems,
  sumStripeLineItems,
} from "@/lib/reservations/build-stripe-line-items";

import {
  priceCatalogLine,
  toPricingCatalogProduct,
  type PricingProductRow,
} from "@louez/api/services/pricing-catalog";
import { evaluatePromoCode } from "@louez/api/services/promo";
import type { ProductPromotion } from "@louez/types";
import { applyProductPromotion, getProductPromotionStatus } from "@louez/utils";
import { productPromotionSchema } from "@louez/validations";

import { computeReservationTotals } from "@/lib/reservations/price-cart";
import type { StorefrontProductPricing } from "@/lib/storefront/storefront.types";
import { getStorefrontProductPrice } from "./util.storefront-product-pricing";
import { getStorefrontPricingSummary, getStorefrontRateRows } from "./util.storefront-pricing";
import {
  getSeasonalCalendarPricing,
  getStorefrontSeasonalRates,
} from "./util.storefront-seasonal-pricing";

const now = new Date("2026-09-12T12:00:00Z");
const promotion: ProductPromotion = { percentage: 20, startsOn: null, endsOn: null };
const timezone = "Europe/Paris";
const period = { startDate: "2026-09-15T07:00:00Z", endDate: "2026-09-17T16:00:00Z" };
const rates = [
  { id: "8h", period: 480, price: 88, minDuration: null, discountPercent: null },
  { id: "day", period: 1440, price: 116, minDuration: null, discountPercent: null },
  { id: "2days", period: 2880, price: 198, minDuration: null, discountPercent: null },
  { id: "week", period: 10080, price: 550, minDuration: null, discountPercent: null },
];
const wingfoil: StorefrontProductPricing = {
  price: 55,
  deposit: 1200,
  basePeriodMinutes: 240,
  enforceStrictTiers: true,
  pricingKind: "duration",
  pricingMode: "hour",
  pricingTiers: rates,
  promotion,
};
const row: PricingProductRow = {
  id: "wing",
  name: "Wingfoil",
  description: null,
  images: [],
  price: "55",
  deposit: "1200",
  pricingKind: "duration",
  pricingMode: "hour",
  basePeriodMinutes: 240,
  enforceStrictTiers: true,
  stockKind: "returnable",
  quantity: 10,
  trackUnits: false,
  bookingAttributeAxes: null,
  taxSettings: null,
  promotion,
};
const catalogProduct = toPricingCatalogProduct(
  row,
  rates.map((rate, displayOrder) => ({ ...rate, price: String(rate.price), displayOrder })),
  [],
);

test("the offer discounts the 550 package, never the artificial 825 reference", () => {
  const result = getStorefrontProductPrice({ product: wingfoil, ...period, timezone, now });
  assert.equal(result.subtotal, 440);
  assert.equal(result.originalSubtotal, 550);
  assert.equal(result.savings, 110);
  assert.equal(result.discountPercent, 20);
  const server = priceCatalogLine(
    { ...catalogProduct, timezone },
    { productId: row.id, quantity: 1, ...period },
    now,
  );
  assert.equal(server.subtotal, result.subtotal);
  assert.deepEqual(server.promotion, result.promotion);
  assert.equal(server.totalDeposit, 1200);
});

test("a future rental qualifies by booking date; promotion is applied once for all quantities", () => {
  const product = {
    ...wingfoil,
    promotion: { ...promotion, startsOn: "2026-09-12", endsOn: "2026-09-12" },
  };
  const result = getStorefrontProductPrice({ product, ...period, quantity: 2, timezone, now });
  assert.equal(result.subtotal, 880);
  assert.equal(result.savings, 220);
  assert.equal(
    getStorefrontProductPrice({
      product,
      ...period,
      timezone,
      now: new Date("2026-09-13T10:00:00Z"),
    }).subtotal,
    550,
  );
});

test("start and end dates include the whole store-local day", () => {
  const offer = { ...promotion, startsOn: "2026-09-12", endsOn: "2026-09-12" };
  assert.equal(
    getProductPromotionStatus(offer, timezone, new Date("2026-09-11T21:59:59Z")),
    "scheduled",
  );
  assert.equal(
    getProductPromotionStatus(offer, timezone, new Date("2026-09-11T22:00:00Z")),
    "active",
  );
  assert.equal(
    getProductPromotionStatus(offer, timezone, new Date("2026-09-12T21:59:59Z")),
    "active",
  );
  assert.equal(
    getProductPromotionStatus(offer, timezone, new Date("2026-09-12T22:00:00Z")),
    "expired",
  );
  assert.equal(
    getProductPromotionStatus(offer, "America/New_York", new Date("2026-09-12T03:59:59Z")),
    "scheduled",
  );
  assert.equal(
    getProductPromotionStatus(offer, "Pacific/Auckland", new Date("2026-09-11T12:00:00Z")),
    "active",
  );
});

test("DST does not shorten the last day of an offer", () => {
  const offer = { ...promotion, endsOn: "2026-10-25" };
  assert.equal(
    getProductPromotionStatus(offer, timezone, new Date("2026-10-25T22:59:59Z")),
    "active",
  );
  assert.equal(
    getProductPromotionStatus(offer, timezone, new Date("2026-10-25T23:00:00Z")),
    "expired",
  );
});

test("prorated prices are the comparison price for an actual offer", () => {
  const product = { price: 15, basePeriodMinutes: 10080, enforceStrictTiers: false, promotion };
  const result = getStorefrontProductPrice({
    product,
    startDate: "2026-09-15T07:00:00Z",
    endDate: "2026-09-29T09:00:00Z",
    timezone,
    now,
  });
  assert.equal(result.originalSubtotal, 30.18);
  assert.equal(result.subtotal, 24.14);
  assert.equal(result.savings, 6.04);
});

test("mixed-season price is calculated first, then discounted once", () => {
  const seasons = [
    {
      id: "high",
      name: "High",
      startDate: "2026-09-16",
      endDate: "2026-09-30",
      basePrice: 40,
      tiers: [],
      rates: [],
    },
  ];
  const product: StorefrontProductPricing = {
    price: 25,
    basePeriodMinutes: 1440,
    enforceStrictTiers: false,
    pricingMode: "day",
    promotion,
    seasonalPricings: seasons,
  };
  const dates = { startDate: "2026-09-15T10:00:00Z", endDate: "2026-09-16T10:00:00Z" };
  const result = getStorefrontProductPrice({ product, ...dates, timezone, now });
  assert.equal(result.originalSubtotal, 32.5);
  assert.equal(result.subtotal, 26);
  const server = priceCatalogLine(
    {
      ...catalogProduct,
      price: 25,
      pricingMode: "day",
      basePeriodMinutes: 1440,
      enforceStrictTiers: false,
      rates: [],
      seasonalPricings: seasons,
      timezone,
    },
    { productId: row.id, quantity: 1, ...dates },
    now,
  );
  assert.equal(server.subtotal, result.subtotal);
  assert.deepEqual(
    getStorefrontSeasonalRates(product, { timezone, now }).map((season) => season.rows[0].price),
    [20, 32],
  );
  const calendar = getSeasonalCalendarPricing(product, { timezone, now });
  assert.equal(calendar?.basePrice, 20);
  assert.equal(calendar?.seasons[0].basePrice, 32);
});

test("catalogue price and every rate row show the same real percentage", () => {
  const summary = getStorefrontPricingSummary(wingfoil, { timezone, now });
  assert.equal(summary.displayPrice, 44);
  assert.equal(summary.compareAt, 55);
  assert.equal(summary.maxReductionPercent, 20);
  const week = getStorefrontRateRows(wingfoil, { timezone, now }).find(
    (rate) => rate.id === "week",
  );
  assert.equal(week?.price, 440);
  assert.equal(week?.compareAt, 550);
  assert.equal(week?.reductionPercent, 20);
  const expired = getStorefrontPricingSummary(
    { ...wingfoil, promotion: { ...promotion, endsOn: "2026-09-11" } },
    { timezone, now },
  );
  assert.equal(expired.displayPrice, 55);
  assert.equal(expired.compareAt, undefined);
  assert.equal(expired.maxReductionPercent, 0);
});

test("fixed prices, deposits, insurance, delivery and VAT remain separate", () => {
  const priced = priceCatalogLine(
    { ...catalogProduct, price: 100, pricingKind: "fixed" },
    { productId: row.id, quantity: 2, ...period },
    now,
  );
  assert.equal(priced.subtotal, 160);
  assert.equal(priced.totalDeposit, 2400);
  const totals = computeReservationTotals({
    lines: [{ ...priced, productName: "Fixed", taxSettings: null }],
    insuranceAmount: 10,
    deliveryFee: 5,
    discountAmount: 0,
    totalDeposit: priced.totalDeposit,
    taxSettings: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
  });
  assert.equal(totals.total, 208);
  assert.equal(totals.deposit, 2400);
});

test("codes use only non-promoted products, with the minimum checked on the entire basket", () => {
  const promo = {
    id: "code",
    code: "SAVE10",
    type: "percentage" as const,
    value: "10",
    minimumAmount: "500",
    maxUsageCount: null,
    currentUsageCount: 0,
    startsAt: null,
    expiresAt: null,
  };
  const result = evaluatePromoCode({ promo, subtotal: 540, discountableSubtotal: 100, now });
  assert.equal(result.ok && result.discountAmount, 10);
  assert.deepEqual(
    evaluatePromoCode({
      promo: { ...promo, minimumAmount: null },
      subtotal: 440,
      discountableSubtotal: 0,
      now,
    }),
    { ok: false, error: "errors.promoCodeProductsAlreadyDiscounted" },
  );
  const fixed = evaluatePromoCode({
    promo: { ...promo, type: "fixed", value: "150" },
    subtotal: 540,
    discountableSubtotal: 100,
    now,
  });
  assert.equal(fixed.ok && fixed.discountAmount, 100);
});

test("invalid offers are rejected; rounding never advertises a zero-cent discount", () => {
  for (const percentage of [0, -10, 100, 1.5, NaN, Infinity])
    assert.equal(productPromotionSchema.safeParse({ ...promotion, percentage }).success, false);
  assert.equal(
    productPromotionSchema.safeParse({ ...promotion, startsOn: "2026-09-13", endsOn: "2026-09-12" })
      .success,
    false,
  );
  assert.equal(
    productPromotionSchema.safeParse({ ...promotion, startsOn: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    productPromotionSchema.safeParse({ ...promotion, startsOn: "2026-09-12", endsOn: "2026-09-12" })
      .success,
    true,
  );
  assert.deepEqual(applyProductPromotion(0.01, { ...promotion, percentage: 1 }, timezone, now), {
    subtotal: 0.01,
    promotion: null,
  });
  assert.equal(
    applyProductPromotion(99.99, { ...promotion, percentage: 33 }, timezone, now).subtotal,
    66.99,
  );
});

test("promotion validation recovers after invalid percentage, dates and removal", async () => {
  let submitted = 0;
  const defaultValues: { promotion: ProductPromotion | null } = { promotion: null };
  const form = new FormApi({
    defaultValues,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: z.object({ promotion: productPromotionSchema.nullable() }) },
    onSubmit: () => {
      submitted += 1;
    },
  });
  const unmountForm = form.mount();
  const field = new FieldApi({ form, name: "promotion" });
  const unmountField = field.mount();
  field.handleChange({ percentage: 0, startsOn: null, endsOn: null });
  await form.handleSubmit();
  assert.equal(submitted, 0);
  field.handleChange(promotion);
  await form.handleSubmit();
  assert.equal(submitted, 1);
  field.handleChange({ ...promotion, startsOn: "2026-09-20", endsOn: "2026-09-19" });
  await form.handleSubmit();
  assert.equal(submitted, 1);
  field.handleChange({ ...promotion, startsOn: "2026-09-20", endsOn: "2026-09-30" });
  await form.handleSubmit();
  assert.equal(submitted, 2);
  field.handleChange({ ...promotion, percentage: 0 });
  await form.handleSubmit();
  assert.equal(submitted, 2);
  field.handleChange(null);
  await form.handleSubmit();
  assert.equal(submitted, 3);
  unmountField();
  unmountForm();
});

test("coupon tax allocation leaves promoted rentals, insurance and delivery untouched", () => {
  const discounted = priceCatalogLine(
    { ...catalogProduct, timezone },
    { productId: row.id, quantity: 1, ...period },
    now,
  );
  const totals = computeReservationTotals({
    lines: [
      { ...discounted, productName: "Wingfoil", taxSettings: null },
      {
        ...discounted,
        promotion: null,
        subtotal: 100,
        productName: "Other",
        taxSettings: { inheritFromStore: false, customRate: 10 },
      },
    ],
    insuranceAmount: 15,
    deliveryFee: 20,
    discountAmount: 10,
    totalDeposit: 1200,
    taxSettings: { enabled: true, defaultRate: 20, displayMode: "exclusive" },
  });
  assert.equal(totals.taxByLineId.get("item:0")?.discountAmount, 0);
  assert.equal(totals.taxByLineId.get("item:1")?.discountAmount, 10);
  assert.equal(totals.taxByLineId.get("insurance")?.amountInclTax, 15);
  assert.equal(totals.taxByLineId.get("delivery")?.amountInclTax, 24);
  assert.equal(totals.total, 666); // 440 * 1.2 + 90 * 1.1 + 15 + 20 * 1.2
});

test("Stripe keeps the exact discounted amount when quantities do not divide into cents", () => {
  const items = buildStripeLineItems({
    reservationNumber: "TEST",
    isPartialPayment: false,
    depositPercentage: 100,
    finalChargeAmount: 0.79,
    displayMode: "inclusive",
    discountAmount: 0,
    items: [{ name: "Accessory", quantity: 3, subtotal: 0.79, taxLine: undefined }],
    insuranceAmount: 0,
    insuranceTaxLine: undefined,
    deliveryFee: 0,
    deliveryTaxLine: undefined,
    toCents: (value) => Math.round(value * 100),
  });
  assert.equal(sumStripeLineItems(items), 79);
  assert.equal(items[0]?.description, "3 × Accessory");
});

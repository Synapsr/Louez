import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSeasonalPricingConfigs,
  toPricingCatalogProduct,
  type PricingCatalog,
  type PricingProductRow,
  type PricingTierRow,
  type SeasonalPricingRow,
  type SeasonalPricingTierRow,
} from "@louez/api/services/pricing-catalog";
import { evaluatePromoCode } from "@louez/api/services/promo";
import type { DeliverySettings, ProductTaxSettings, Rate, TaxSettings } from "@louez/types";
import {
  calculateFixedPrice,
  calculateDuration as calcDuration,
  calculateSeasonalAwarePrice,
  calculateTaxBreakdown,
  extractExclusiveFromInclusive,
  getEffectiveTaxRate,
  taxSettingsToConfig,
  type SeasonalPricingConfig,
} from "@louez/utils";

import { calculateTotalDeliveryFee } from "@/lib/utils/geo";

import { getCheckoutChargeAmount } from "./build-stripe-line-items";
import {
  computeReservationTotals,
  getReservationItemTaxFields,
  priceCart,
  type PricedCartLine,
} from "./price-cart";

// ---------------------------------------------------------------------------
// Fixtures: raw rows as Drizzle returns them
// ---------------------------------------------------------------------------

const START = "2026-07-10T09:00:00.000Z";
const END = "2026-07-12T14:00:00.000Z"; // 2 days 5 h → 3 billed days

const productRow = (overrides: Partial<PricingProductRow> & { id: string }): PricingProductRow => ({
  name: `Product ${overrides.id}`,
  description: null,
  images: [],
  price: "10.00",
  deposit: "0",
  pricingKind: "duration",
  pricingMode: "day",
  basePeriodMinutes: null,
  enforceStrictTiers: false,
  stockKind: "returnable",
  quantity: 10,
  trackUnits: false,
  bookingAttributeAxes: null,
  taxSettings: null,
  ...overrides,
});

const tierRow = (overrides: Partial<PricingTierRow> & { id: string }): PricingTierRow => ({
  minDuration: null,
  discountPercent: null,
  displayOrder: null,
  period: null,
  price: null,
  ...overrides,
});

const fixedProduct = productRow({
  id: "fixed",
  pricingKind: "fixed",
  price: "15.50",
  deposit: "0",
});
const tieredProduct = productRow({ id: "tiered", price: "40.00", deposit: "100.00" });
const tieredTiers = [
  tierRow({ id: "t1", minDuration: 3, discountPercent: "10.000000", displayOrder: 0 }),
  tierRow({ id: "t2", minDuration: 7, discountPercent: "20.000000", displayOrder: 1 }),
];
const seasonalProduct = productRow({ id: "seasonal", price: "50.00", deposit: "20.00" });
const seasonalRows: SeasonalPricingRow[] = [
  {
    id: "summer",
    productId: "seasonal",
    name: "Summer",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    price: "80.00",
  },
];
const seasonalTierRows: SeasonalPricingTierRow[] = [
  {
    id: "summer-t1",
    seasonalPricingId: "summer",
    minDuration: 2,
    discountPercent: "5.000000",
    displayOrder: 0,
    period: null,
    price: null,
  },
];
const strictProduct = productRow({
  id: "strict",
  price: "30.00",
  deposit: "50.00",
  basePeriodMinutes: 1440,
  enforceStrictTiers: true,
  taxSettings: { inheritFromStore: false, customRate: 10 } satisfies ProductTaxSettings,
});
const strictTiers = [
  tierRow({ id: "r1", period: 1440, price: "30.00", displayOrder: 0 }),
  tierRow({ id: "r2", period: 4320, price: "75.00", displayOrder: 1 }),
];

const tiersByProduct = new Map<string, PricingTierRow[]>([
  ["tiered", tieredTiers],
  ["strict", strictTiers],
]);

const products = [fixedProduct, tieredProduct, seasonalProduct, strictProduct];

const lines = [
  { productId: "fixed", quantity: 2, startDate: START, endDate: END },
  { productId: "tiered", quantity: 1, startDate: START, endDate: END },
  { productId: "seasonal", quantity: 3, startDate: START, endDate: END },
  { productId: "strict", quantity: 1, startDate: START, endDate: END },
];

const deliverySettings: DeliverySettings = {
  enabled: true,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 10,
  maximumDistance: null,
  freeDeliveryThreshold: null,
};

const ttc: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "inclusive" };
const ht: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "exclusive" };

interface Scenario {
  name: string;
  tax: TaxSettings | undefined;
  promo: { type: "percentage" | "fixed"; value: string } | null;
  delivery: { outboundKm: number | null; returnKm: number | null } | null;
  insuranceAmount: number;
  depositPercentage: number;
}

const scenarios: Scenario[] = [
  {
    name: "no tax, no extras, full payment",
    tax: undefined,
    promo: null,
    delivery: null,
    insuranceAmount: 0,
    depositPercentage: 100,
  },
  {
    name: "TTC, promo 10%, delivery, insurance",
    tax: ttc,
    promo: { type: "percentage", value: "10.00" },
    delivery: { outboundKm: 12.5, returnKm: 8 },
    insuranceAmount: 12.34,
    depositPercentage: 100,
  },
  {
    name: "HT, promo fixed 25, delivery, insurance, partial 30%",
    tax: ht,
    promo: { type: "fixed", value: "25.00" },
    delivery: { outboundKm: 3, returnKm: null },
    insuranceAmount: 9.99,
    depositPercentage: 30,
  },
  {
    name: "TTC, promo fixed above subtotal (capped), partial 50%",
    tax: ttc,
    promo: { type: "fixed", value: "9999.00" },
    delivery: null,
    insuranceAmount: 0,
    depositPercentage: 50,
  },
  {
    name: "HT, no promo, delivery only, partial 15%",
    tax: ht,
    promo: null,
    delivery: { outboundKm: 0.5, returnKm: 40 },
    insuranceAmount: 0,
    depositPercentage: 15,
  },
];

// ---------------------------------------------------------------------------
// Legacy path: the checkout action's inline pricing, copied verbatim
// ---------------------------------------------------------------------------

interface LegacyItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  depositPerUnit: number;
  subtotal: number;
  totalDeposit: number;
}

const legacyPriceItems = (): { items: LegacyItem[]; subtotal: number; deposit: number } => {
  const serverCalculatedItems: LegacyItem[] = [];
  let serverSubtotal = 0;
  let serverTotalDeposit = 0;

  for (const item of lines) {
    const product = products.find((candidate) => candidate.id === item.productId);
    assert.ok(product);
    const productPricingMode = product.pricingMode;
    calcDuration(item.startDate, item.endDate, productPricingMode);

    let pricingResult: { subtotal: number; deposit: number; effectivePricePerUnit: number };

    if (product.pricingKind === "fixed") {
      pricingResult = calculateFixedPrice(
        {
          basePrice: Number(product.price),
          deposit: Number(product.deposit || 0),
          pricingMode: productPricingMode,
        },
        item.quantity,
      );
    } else {
      const seasonalPricingsRaw = seasonalRows.filter((row) => row.productId === product.id);
      let seasonalPricingConfigs: SeasonalPricingConfig[] = [];
      if (seasonalPricingsRaw.length > 0) {
        const spIds = seasonalPricingsRaw.map((sp) => sp.id);
        const spTiersRaw = seasonalTierRows.filter((row) => spIds.includes(row.seasonalPricingId));
        const spTiersByPricingId = new Map<string, typeof spTiersRaw>();
        for (const tier of spTiersRaw) {
          const tiers = spTiersByPricingId.get(tier.seasonalPricingId) || [];
          tiers.push(tier);
          spTiersByPricingId.set(tier.seasonalPricingId, tiers);
        }
        seasonalPricingConfigs = seasonalPricingsRaw.map((sp) => {
          const spTiers = spTiersByPricingId.get(sp.id) || [];
          return {
            id: sp.id,
            name: sp.name,
            startDate: sp.startDate,
            endDate: sp.endDate,
            basePrice: Number(sp.price),
            tiers: spTiers
              .filter((t) => t.minDuration !== null && t.discountPercent !== null)
              .map((t) => ({
                id: t.id,
                minDuration: t.minDuration!,
                discountPercent: Number(t.discountPercent!),
                displayOrder: t.displayOrder ?? 0,
              })),
            rates: spTiers
              .filter((t) => t.period !== null && t.price !== null)
              .map((t) => ({
                id: t.id,
                period: t.period!,
                price: Number(t.price!),
                displayOrder: t.displayOrder ?? 0,
              })),
          };
        });
      }

      const pricingTiers = tiersByProduct.get(product.id) ?? [];
      const baseTiers = pricingTiers.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration ?? 1,
        discountPercent: Number(tier.discountPercent ?? 0),
        displayOrder: tier.displayOrder || 0,
      }));
      const baseRates: Rate[] = pricingTiers
        .filter(
          (tier): tier is typeof tier & { period: number; price: string } =>
            typeof tier.period === "number" && tier.period > 0 && typeof tier.price === "string",
        )
        .map(
          (tier, index): Rate => ({
            id: tier.id,
            period: tier.period,
            price: Number(tier.price),
            displayOrder: tier.displayOrder ?? index,
          }),
        );

      const seasonalResult = calculateSeasonalAwarePrice(
        {
          basePrice: Number(product.price),
          basePeriodMinutes: product.basePeriodMinutes ?? null,
          deposit: Number(product.deposit || 0),
          pricingKind: product.pricingKind,
          pricingMode: productPricingMode,
          enforceStrictTiers: product.enforceStrictTiers ?? false,
          tiers: baseTiers,
          rates: baseRates,
        },
        seasonalPricingConfigs,
        item.startDate,
        item.endDate,
        item.quantity,
      );
      pricingResult = {
        subtotal: seasonalResult.subtotal,
        deposit: seasonalResult.deposit,
        effectivePricePerUnit: seasonalResult.subtotal / Math.max(1, item.quantity),
      };
    }

    serverCalculatedItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: pricingResult.effectivePricePerUnit,
      depositPerUnit: Number(product.deposit || 0),
      subtotal: pricingResult.subtotal,
      totalDeposit: pricingResult.deposit,
    });
    serverSubtotal += pricingResult.subtotal;
    serverTotalDeposit += pricingResult.deposit;
  }

  return { items: serverCalculatedItems, subtotal: serverSubtotal, deposit: serverTotalDeposit };
};

interface LegacyTotals {
  subtotal: number;
  discount: number;
  deposit: number;
  deliveryFee: number;
  total: number;
  subtotalExclTax: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  chargeAmount: number;
  items: Array<{
    unitPrice: number;
    subtotal: number;
    taxRate: number | null;
    taxAmount: number | null;
    priceExclTax: number | null;
    totalExclTax: number | null;
  }>;
}

const legacyTotals = (scenario: Scenario): LegacyTotals => {
  const priced = legacyPriceItems();
  const serverSubtotal = priced.subtotal;

  let deliveryFee = 0;
  if (scenario.delivery) {
    deliveryFee = calculateTotalDeliveryFee(
      scenario.delivery.outboundKm,
      scenario.delivery.returnKm,
      deliverySettings,
      serverSubtotal,
    ).totalFee;
  }

  let serverDiscountAmount = 0;
  if (scenario.promo) {
    const promoValue = parseFloat(scenario.promo.value);
    if (scenario.promo.type === "percentage") {
      serverDiscountAmount = Math.min((serverSubtotal * promoValue) / 100, serverSubtotal);
    } else {
      serverDiscountAmount = Math.min(promoValue, serverSubtotal);
    }
    serverDiscountAmount = Math.round(serverDiscountAmount * 100) / 100;
  }

  const tulipInsuranceAmount = scenario.insuranceAmount;
  const finalSubtotal = serverSubtotal + tulipInsuranceAmount;
  const finalDiscount = serverDiscountAmount;
  const finalDeposit = priced.deposit;
  const finalDeliveryFee = deliveryFee;

  const taxConfig = taxSettingsToConfig(scenario.tax);
  const taxEnabled = taxConfig?.enabled ?? false;
  const storeTaxRate = taxConfig?.rate ?? 0;
  const displayMode = taxConfig?.displayMode ?? "inclusive";
  const taxableLines = priced.items.map((serverItem, index) => {
    const product = products.find((candidate) => candidate.id === serverItem.productId);
    return {
      id: `item:${index}`,
      amount: serverItem.subtotal,
      taxRate: getEffectiveTaxRate(taxConfig, product?.taxSettings),
    };
  });
  if (tulipInsuranceAmount > 0) {
    taxableLines.push({ id: "insurance", amount: tulipInsuranceAmount, taxRate: null });
  }
  const taxCalculation = calculateTaxBreakdown({
    lines: taxableLines,
    deliveryFee: finalDeliveryFee,
    discountAmount: finalDiscount,
    depositAmount: finalDeposit,
    taxConfig,
  });
  const taxCalculationByLineId = new Map(taxCalculation.lines.map((line) => [line.id, line]));
  const finalTotal = taxCalculation.totalInclTax;

  const items = priced.items.map((serverItem, i) => {
    let itemTaxRate: number | null = null;
    let itemTaxAmount: number | null = null;
    let itemPriceExclTax: number | null = null;
    let itemTotalExclTax: number | null = null;
    const itemTaxCalculation = taxCalculationByLineId.get(`item:${i}`);
    if (taxEnabled && itemTaxCalculation && itemTaxCalculation.taxRate !== null) {
      itemTaxRate = itemTaxCalculation.taxRate;
      itemPriceExclTax =
        displayMode === "inclusive"
          ? extractExclusiveFromInclusive(serverItem.unitPrice, itemTaxCalculation.taxRate)
          : serverItem.unitPrice;
      itemTotalExclTax = itemTaxCalculation.amountExclTax;
      itemTaxAmount = itemTaxCalculation.taxAmount;
    }
    return {
      unitPrice: serverItem.unitPrice,
      subtotal: serverItem.subtotal,
      taxRate: itemTaxRate,
      taxAmount: itemTaxAmount,
      priceExclTax: itemPriceExclTax,
      totalExclTax: itemTotalExclTax,
    };
  });

  const depositPercentage = scenario.depositPercentage;
  const isPartialPayment = depositPercentage < 100;
  const chargeableTotal = finalTotal;
  const amountToCharge = isPartialPayment
    ? Math.round(chargeableTotal * depositPercentage) / 100
    : chargeableTotal;
  const MINIMUM_STRIPE_AMOUNT = 0.5;
  const effectiveChargeAmount = Math.max(amountToCharge, MINIMUM_STRIPE_AMOUNT);
  const finalChargeAmount = Math.min(effectiveChargeAmount, chargeableTotal);

  return {
    subtotal: finalSubtotal,
    discount: finalDiscount,
    deposit: finalDeposit,
    deliveryFee: finalDeliveryFee,
    total: finalTotal,
    subtotalExclTax: taxEnabled ? taxCalculation.subtotalExclTax : null,
    taxAmount: taxEnabled ? taxCalculation.taxAmount : null,
    taxRate: taxEnabled ? storeTaxRate : null,
    chargeAmount: finalChargeAmount,
    items,
  };
};

// ---------------------------------------------------------------------------
// New path: pricing catalog + price-cart modules
// ---------------------------------------------------------------------------

const buildCatalog = (): PricingCatalog => {
  const seasonalByProduct = buildSeasonalPricingConfigs(seasonalRows, seasonalTierRows);
  return new Map(
    products.map((product) => [
      product.id,
      toPricingCatalogProduct(
        product,
        tiersByProduct.get(product.id) ?? [],
        seasonalByProduct.get(product.id) ?? [],
      ),
    ]),
  );
};

const newTotals = (scenario: Scenario): LegacyTotals => {
  const priced = priceCart({ catalog: buildCatalog(), lines });
  assert.ok(priced.ok);
  const cart = priced.cart;

  const deliveryFee = scenario.delivery
    ? calculateTotalDeliveryFee(
        scenario.delivery.outboundKm,
        scenario.delivery.returnKm,
        deliverySettings,
        cart.subtotal,
      ).totalFee
    : 0;

  let discount = 0;
  if (scenario.promo) {
    const evaluation = evaluatePromoCode({
      promo: {
        id: "promo",
        code: "PROMO",
        type: scenario.promo.type,
        value: scenario.promo.value,
        minimumAmount: null,
        maxUsageCount: null,
        currentUsageCount: 0,
        startsAt: null,
        expiresAt: null,
      },
      subtotal: cart.subtotal,
    });
    assert.ok(evaluation.ok);
    discount = evaluation.discountAmount;
  }

  const totals = computeReservationTotals({
    lines: cart.lines,
    insuranceAmount: scenario.insuranceAmount,
    discountAmount: discount,
    deliveryFee,
    totalDeposit: cart.totalDeposit,
    taxSettings: scenario.tax,
  });
  const charge = getCheckoutChargeAmount({
    total: totals.total,
    depositPercentage: scenario.depositPercentage,
  });

  return {
    subtotal: totals.subtotal,
    discount: totals.discount,
    deposit: totals.deposit,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    subtotalExclTax: totals.subtotalExclTax,
    taxAmount: totals.taxAmount,
    taxRate: totals.taxRate,
    chargeAmount: charge.finalChargeAmount,
    items: cart.lines.map((line: PricedCartLine, index) => ({
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      ...getReservationItemTaxFields(totals, line, index),
    })),
  };
};

const cents = (value: number | null): string | null => (value === null ? null : value.toFixed(2));

for (const scenario of scenarios) {
  test(`price-cart parity with the legacy checkout pricing: ${scenario.name}`, () => {
    const legacy = legacyTotals(scenario);
    const current = newTotals(scenario);

    assert.equal(cents(current.subtotal), cents(legacy.subtotal));
    assert.equal(cents(current.discount), cents(legacy.discount));
    assert.equal(cents(current.deposit), cents(legacy.deposit));
    assert.equal(cents(current.deliveryFee), cents(legacy.deliveryFee));
    assert.equal(cents(current.total), cents(legacy.total));
    assert.equal(cents(current.subtotalExclTax), cents(legacy.subtotalExclTax));
    assert.equal(cents(current.taxAmount), cents(legacy.taxAmount));
    assert.equal(current.taxRate, legacy.taxRate);
    assert.equal(cents(current.chargeAmount), cents(legacy.chargeAmount));

    assert.equal(current.items.length, legacy.items.length);
    current.items.forEach((item, index) => {
      const expected = legacy.items[index];
      assert.equal(cents(item.unitPrice), cents(expected.unitPrice));
      assert.equal(cents(item.subtotal), cents(expected.subtotal));
      assert.equal(item.taxRate, expected.taxRate);
      assert.equal(cents(item.taxAmount), cents(expected.taxAmount));
      assert.equal(cents(item.priceExclTax), cents(expected.priceExclTax));
      assert.equal(cents(item.totalExclTax), cents(expected.totalExclTax));
    });
  });
}

test("priceCart reports the first unknown product instead of pricing partially", () => {
  const result = priceCart({
    catalog: buildCatalog(),
    lines: [lines[0], { productId: "ghost", quantity: 1, startDate: START, endDate: END }],
  });
  assert.deepEqual(result, { ok: false, missingProductId: "ghost" });
});

test("the fixtures exercise every pricing kind (fixed, tiered, seasonal, strict)", () => {
  const priced = priceCart({ catalog: buildCatalog(), lines });
  assert.ok(priced.ok);
  const byId = new Map(priced.cart.lines.map((line) => [line.productId, line]));

  // Fixed: price × quantity, no duration.
  assert.equal(byId.get("fixed")?.subtotal, 31);
  assert.equal(byId.get("fixed")?.duration, 1);
  // Tiered day product: 3 billed days with the 10% tier.
  assert.equal(byId.get("tiered")?.duration, 3);
  assert.equal(byId.get("tiered")?.subtotal, 108);
  // Seasonal: summer base price applies (80 instead of 50), so more than 3 × 50 × 3.
  assert.ok((byId.get("seasonal")?.subtotal ?? 0) > 450);
  // Strict rate-based: 2 d 5 h rounds up to the 3-day rate, never interpolated.
  assert.equal(byId.get("strict")?.subtotal, 75);
  assert.equal(priced.cart.totalDeposit, 100 + 3 * 20 + 50);
});

test("computeReservationTotals keeps insurance out of VAT and the deposit out of the total", () => {
  const priced = priceCart({ catalog: buildCatalog(), lines: [lines[0]] });
  assert.ok(priced.ok);
  const totals = computeReservationTotals({
    lines: priced.cart.lines,
    insuranceAmount: 10,
    discountAmount: 0,
    deliveryFee: 0,
    totalDeposit: 500,
    taxSettings: ttc,
  });
  assert.equal(totals.subtotal, 41);
  assert.equal(totals.total, 41);
  assert.equal(totals.taxByLineId.get("insurance")?.taxAmount, 0);
  assert.equal(totals.deposit, 500);
});

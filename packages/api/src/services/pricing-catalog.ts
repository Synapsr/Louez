import type { AppliedProductPromotion, ProductPromotion } from "@louez/types";
import { applyProductPromotion } from "@louez/utils";
import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@louez/db";
import {
  productPricingTiers,
  productSeasonalPricing,
  productSeasonalPricingTiers,
  products,
} from "@louez/db/schema";
import type {
  BookingAttributeAxis,
  PricingKind,
  PricingMode,
  ProductTaxSettings,
  Rate,
  StockKind,
} from "@louez/types";
import {
  calculateDuration,
  calculateFixedPrice,
  calculateSeasonalAwarePrice,
  type SeasonalPricingConfig,
} from "@louez/utils";

/**
 * One product as the pricing engine sees it: base price, tiers, rates and
 * seasonal configs already normalized from the database rows, plus the stock
 * and tax fields checkout needs next to the price.
 */
export interface PricingCatalogProduct {
  timezone?: string;
  promotion?: ProductPromotion | null;
  id: string;
  name: string;
  description: string | null;
  images: string[];
  price: number;
  deposit: number;
  pricingKind: PricingKind;
  pricingMode: PricingMode;
  basePeriodMinutes: number | null;
  enforceStrictTiers: boolean;
  stockKind: StockKind;
  quantity: number;
  trackUnits: boolean;
  bookingAttributeAxes: BookingAttributeAxis[] | null;
  taxSettings: ProductTaxSettings | null;
  tiers: Array<{ id: string; minDuration: number; discountPercent: number; displayOrder: number }>;
  rates: Rate[];
  seasonalPricings: SeasonalPricingConfig[];
}

export type PricingCatalog = Map<string, PricingCatalogProduct>;

export interface PricingCatalogLineInput {
  productId: string;
  quantity: number;
  startDate: string;
  endDate: string;
}

export interface PricedCatalogLine {
  promotion?: AppliedProductPromotion | null;
  productId: string;
  quantity: number;
  pricingKind: PricingKind;
  /** Billed periods (always 1 for a fixed-price product). */
  duration: number;
  /** Effective price per unit for the whole rental (subtotal / quantity). */
  unitPrice: number;
  depositPerUnit: number;
  subtotal: number;
  originalSubtotal: number;
  savings: number;
  totalDeposit: number;
}

/** The product columns the catalog reads (a subset of the row, so fixtures stay small). */
export type PricingProductRow = Pick<
  typeof products.$inferSelect,
  | "id"
  | "name"
  | "description"
  | "images"
  | "price"
  | "deposit"
  | "pricingKind"
  | "pricingMode"
  | "basePeriodMinutes"
  | "enforceStrictTiers"
  | "stockKind"
  | "quantity"
  | "trackUnits"
  | "bookingAttributeAxes"
  | "taxSettings"
> & { promotion?: ProductPromotion | null };
export type PricingTierRow = Pick<
  typeof productPricingTiers.$inferSelect,
  "id" | "minDuration" | "discountPercent" | "displayOrder" | "period" | "price"
>;
export type SeasonalPricingRow = Pick<
  typeof productSeasonalPricing.$inferSelect,
  "id" | "productId" | "name" | "startDate" | "endDate" | "price"
>;
export type SeasonalPricingTierRow = Pick<
  typeof productSeasonalPricingTiers.$inferSelect,
  | "id"
  | "seasonalPricingId"
  | "minDuration"
  | "discountPercent"
  | "displayOrder"
  | "period"
  | "price"
>;

/** Seasonal rows → engine configs, grouped by product (same mapping as the cart resolver). */
export const buildSeasonalPricingConfigs = (
  seasonalRows: SeasonalPricingRow[],
  tierRows: SeasonalPricingTierRow[],
): Map<string, SeasonalPricingConfig[]> => {
  const tiersBySeasonalPricingId = new Map<string, SeasonalPricingTierRow[]>();
  for (const tier of tierRows) {
    const tiers = tiersBySeasonalPricingId.get(tier.seasonalPricingId) || [];
    tiers.push(tier);
    tiersBySeasonalPricingId.set(tier.seasonalPricingId, tiers);
  }

  const byProductId = new Map<string, SeasonalPricingConfig[]>();
  for (const seasonalPricing of seasonalRows) {
    const tiers = tiersBySeasonalPricingId.get(seasonalPricing.id) || [];
    const current = byProductId.get(seasonalPricing.productId) || [];

    current.push({
      id: seasonalPricing.id,
      name: seasonalPricing.name,
      startDate: seasonalPricing.startDate,
      endDate: seasonalPricing.endDate,
      basePrice: Number(seasonalPricing.price),
      tiers: tiers.flatMap((tier) =>
        tier.minDuration !== null && tier.discountPercent !== null
          ? [
              {
                id: tier.id,
                minDuration: tier.minDuration,
                discountPercent: Number(tier.discountPercent),
                displayOrder: tier.displayOrder ?? 0,
              },
            ]
          : [],
      ),
      rates: tiers.flatMap((tier) =>
        tier.period !== null && tier.price !== null
          ? [
              {
                id: tier.id,
                period: tier.period,
                price: Number(tier.price),
                displayOrder: tier.displayOrder ?? 0,
              },
            ]
          : [],
      ),
    });

    byProductId.set(seasonalPricing.productId, current);
  }

  return byProductId;
};

/** Product row + its tier rows → catalog entry (same normalization as checkout used inline). */
export const toPricingCatalogProduct = (
  product: PricingProductRow,
  tierRows: PricingTierRow[],
  seasonalPricings: SeasonalPricingConfig[],
): PricingCatalogProduct => ({
  id: product.id,
  name: product.name,
  description: product.description ?? null,
  images: product.images ?? [],
  price: Number(product.price),
  deposit: Number(product.deposit || 0),
  pricingKind: product.pricingKind,
  pricingMode: product.pricingMode,
  basePeriodMinutes: product.basePeriodMinutes ?? null,
  enforceStrictTiers: product.enforceStrictTiers ?? false,
  stockKind: product.stockKind,
  quantity: product.quantity,
  trackUnits: product.trackUnits,
  bookingAttributeAxes: product.bookingAttributeAxes ?? null,
  taxSettings: product.taxSettings ?? null,
  promotion: product.promotion ?? null,
  tiers: tierRows.map((tier) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent: Number(tier.discountPercent ?? 0),
    displayOrder: tier.displayOrder || 0,
  })),
  rates: tierRows.flatMap((tier, index) =>
    typeof tier.period === "number" && tier.period > 0 && typeof tier.price === "string"
      ? [
          {
            id: tier.id,
            period: tier.period,
            price: Number(tier.price),
            displayOrder: tier.displayOrder ?? index,
          },
        ]
      : [],
  ),
  seasonalPricings,
});

/**
 * Price one cart line from the catalog entry. Fixed-price products ignore the
 * duration; everything else goes through the seasonal-aware engine (which
 * handles legacy tiers, rate-based and strict tiers).
 */
const priceRegularCatalogLine = (
  product: PricingCatalogProduct,
  line: PricingCatalogLineInput,
): PricedCatalogLine => {
  const duration = calculateDuration(line.startDate, line.endDate, product.pricingMode);

  if (product.pricingKind === "fixed") {
    const fixed = calculateFixedPrice(
      { basePrice: product.price, deposit: product.deposit, pricingMode: product.pricingMode },
      line.quantity,
    );
    return {
      productId: product.id,
      quantity: line.quantity,
      pricingKind: product.pricingKind,
      duration: 1,
      unitPrice: fixed.effectivePricePerUnit,
      depositPerUnit: product.deposit,
      subtotal: fixed.subtotal,
      originalSubtotal: fixed.originalSubtotal,
      savings: fixed.savings,
      totalDeposit: fixed.deposit,
    };
  }

  const seasonal = calculateSeasonalAwarePrice(
    {
      timezone: product.timezone,
      basePrice: product.price,
      basePeriodMinutes: product.basePeriodMinutes,
      deposit: product.deposit,
      pricingKind: product.pricingKind,
      pricingMode: product.pricingMode,
      enforceStrictTiers: product.enforceStrictTiers,
      tiers: product.tiers,
      rates: product.rates,
    },
    product.seasonalPricings,
    line.startDate,
    line.endDate,
    line.quantity,
  );

  return {
    productId: product.id,
    quantity: line.quantity,
    pricingKind: product.pricingKind,
    duration,
    unitPrice: seasonal.subtotal / Math.max(1, line.quantity),
    depositPerUnit: product.deposit,
    subtotal: seasonal.subtotal,
    originalSubtotal: seasonal.originalSubtotal,
    savings: seasonal.savings,
    totalDeposit: seasonal.deposit,
  };
};

export const priceCatalogLine = (
  product: PricingCatalogProduct,
  line: PricingCatalogLineInput,
  now?: Date,
): PricedCatalogLine => {
  const regular = priceRegularCatalogLine(product, line);
  const discounted = applyProductPromotion(
    regular.subtotal,
    product.promotion,
    product.timezone,
    now,
  );
  if (!discounted.promotion) return regular;
  return {
    ...regular,
    subtotal: discounted.subtotal,
    unitPrice: discounted.subtotal / Math.max(1, line.quantity),
    originalSubtotal: discounted.promotion.originalSubtotal,
    savings: discounted.promotion.discountAmount,
    promotion: discounted.promotion,
  };
};

/**
 * Load every active product of the store referenced by `productIds` with its
 * pricing tiers and seasonal configs, in four queries regardless of cart size.
 * Missing ids are simply absent from the map.
 */
export const loadPricingCatalog = async (
  database: Pick<Database, "select">,
  params: { storeId: string; productIds: string[]; timezone?: string },
): Promise<PricingCatalog> => {
  const productIds = [...new Set(params.productIds)];
  if (productIds.length === 0) {
    return new Map();
  }

  const productRows = await database
    .select()
    .from(products)
    .where(
      and(
        eq(products.storeId, params.storeId),
        eq(products.status, "active"),
        inArray(products.id, productIds),
      ),
    );
  if (productRows.length === 0) {
    return new Map();
  }

  const foundIds = productRows.map((product) => product.id);
  const [tierRows, seasonalRows] = await Promise.all([
    database
      .select()
      .from(productPricingTiers)
      .where(inArray(productPricingTiers.productId, foundIds)),
    database
      .select()
      .from(productSeasonalPricing)
      .where(inArray(productSeasonalPricing.productId, foundIds)),
  ]);
  const seasonalTierRows =
    seasonalRows.length > 0
      ? await database
          .select()
          .from(productSeasonalPricingTiers)
          .where(
            inArray(
              productSeasonalPricingTiers.seasonalPricingId,
              seasonalRows.map((row) => row.id),
            ),
          )
      : [];

  const tiersByProductId = new Map<string, PricingTierRow[]>();
  for (const tier of tierRows) {
    const tiers = tiersByProductId.get(tier.productId) || [];
    tiers.push(tier);
    tiersByProductId.set(tier.productId, tiers);
  }
  const seasonalByProductId = buildSeasonalPricingConfigs(seasonalRows, seasonalTierRows);

  return new Map(
    productRows.map((product) => [
      product.id,
      {
        ...(params.timezone ? { timezone: params.timezone } : {}),
        ...toPricingCatalogProduct(
          product,
          tiersByProductId.get(product.id) || [],
          seasonalByProductId.get(product.id) || [],
        ),
      },
    ]),
  );
};

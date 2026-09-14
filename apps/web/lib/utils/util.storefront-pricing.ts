import { applyProductPromotion } from "@louez/utils";
import type { PricingKind } from "@louez/types";
import { pricingModeToMinutes } from "@louez/utils";

import type {
  StorefrontPricingTier,
  StorefrontProductPricing,
} from "@/lib/storefront/storefront.types";
import {
  getStorefrontPricingMode,
  parseStorefrontDecimal,
} from "@/lib/utils/util.storefront-product-pricing";

export type StorefrontPricingProduct = Pick<
  StorefrontProductPricing,
  "price" | "pricingKind" | "pricingMode" | "basePeriodMinutes" | "pricingTiers" | "promotion"
>;

export interface StorefrontRateRow {
  compareAt?: number;
  id: string;
  periodMinutes: number;
  price: number;
  reductionPercent: number;
}

export interface StorefrontPricingSummary {
  compareAt?: number;
  pricingKind: PricingKind;
  displayPrice: number;
  /**
   * Period the displayed price covers, or `null` on a fixed-price product:
   * a forfait is billed per booking, so there is no "/ day" suffix to render.
   */
  displayPeriodMinutes: number | null;
  maxReductionPercent: number;
  allReductionPercents: number[];
}

const BASE_RATE_ID = "__base__";

const toRateBasedRow = (tier: StorefrontPricingTier): StorefrontRateRow | null => {
  const periodMinutes = typeof tier.period === "number" && tier.period > 0 ? tier.period : null;
  if (!periodMinutes) return null;

  const price = parseStorefrontDecimal(tier.price) ?? 0;

  return {
    id: tier.id,
    periodMinutes,
    price,
    reductionPercent: 0,
  };
};

const toDurationRow =
  (basePrice: number, basePeriodMinutes: number) =>
  (tier: StorefrontPricingTier): StorefrontRateRow | null => {
    const minDuration =
      typeof tier.minDuration === "number" && tier.minDuration > 0 ? tier.minDuration : null;
    if (!minDuration) return null;

    const reductionPercent = Math.max(0, parseStorefrontDecimal(tier.discountPercent) ?? 0);

    return {
      id: tier.id,
      periodMinutes: minDuration * basePeriodMinutes,
      price: basePrice * (1 - reductionPercent / 100) * minDuration,
      reductionPercent,
    };
  };

const isRow = (row: StorefrontRateRow | null): row is StorefrontRateRow => row !== null;

const compareRows = (a: StorefrontRateRow, b: StorefrontRateRow): number =>
  a.periodMinutes !== b.periodMinutes ? a.periodMinutes - b.periodMinutes : a.price - b.price;

const getBaseRate = (product: StorefrontPricingProduct): StorefrontRateRow => {
  const basePeriodMinutes = product.basePeriodMinutes;
  const isRateBased = typeof basePeriodMinutes === "number" && basePeriodMinutes > 0;

  return {
    id: BASE_RATE_ID,
    periodMinutes: isRateBased
      ? basePeriodMinutes
      : pricingModeToMinutes(getStorefrontPricingMode(product)),
    price: parseStorefrontDecimal(product.price) ?? 0,
    reductionPercent: 0,
  };
};

/**
 * Unique rates sorted by period, including the base rate. Stored copies of
 * a rate share one row. A forfait has no grid.
 */
const getRegularStorefrontRateRows = (product: StorefrontPricingProduct): StorefrontRateRow[] => {
  if (product.pricingKind === "fixed") return [];

  const baseRate = getBaseRate(product);
  const isRateBased =
    typeof product.basePeriodMinutes === "number" && product.basePeriodMinutes > 0;
  const toRow = isRateBased
    ? toRateBasedRow
    : toDurationRow(baseRate.price, baseRate.periodMinutes);
  const tierRows = (product.pricingTiers ?? []).map(toRow).filter(isRow);
  const seen = new Set<string>();

  return [baseRate, ...tierRows].sort(compareRows).filter((row) => {
    const key = `${row.periodMinutes}:${row.price}:${row.reductionPercent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Pricing summary for a product card without dates: the base rate (what
 * the shortest rental costs) and the discounts longer rentals unlock. Never
 * "from": normalising the cheapest per-minute rate to the base period gave
 * prices like "3.83 EUR / 4 h" when the real 4-hour price was 27 EUR.
 */
const getRegularStorefrontPricingSummary = (
  product: StorefrontPricingProduct,
): StorefrontPricingSummary => {
  if (product.pricingKind === "fixed") {
    return {
      pricingKind: "fixed",
      displayPrice: parseStorefrontDecimal(product.price) ?? 0,
      displayPeriodMinutes: null,
      maxReductionPercent: 0,
      allReductionPercents: [],
    };
  }

  const baseRate = getBaseRate(product);
  const allReductionPercents = getRegularStorefrontRateRows(product)
    .map((row) => row.reductionPercent)
    .filter((percent) => percent > 0);

  return {
    pricingKind: "duration",
    displayPrice: baseRate.price,
    displayPeriodMinutes: baseRate.periodMinutes,
    maxReductionPercent: Math.max(...allReductionPercents, 0),
    allReductionPercents,
  };
};

export const getStorefrontRateRows = (
  product: StorefrontPricingProduct,
  options: { timezone?: string; now?: Date } = {},
): StorefrontRateRow[] =>
  getRegularStorefrontRateRows(product).map((row) => {
    const result = applyProductPromotion(
      row.price,
      product.promotion,
      options.timezone,
      options.now,
    );
    return result.promotion
      ? {
          ...row,
          price: result.subtotal,
          compareAt: row.price,
          reductionPercent: result.promotion.percentage,
        }
      : row;
  });

export const getStorefrontPricingSummary = (
  product: StorefrontPricingProduct,
  options: { timezone?: string; now?: Date } = {},
): StorefrontPricingSummary => {
  const regular = getRegularStorefrontPricingSummary(product);
  const result = applyProductPromotion(
    regular.displayPrice,
    product.promotion,
    options.timezone,
    options.now,
  );
  return result.promotion
    ? {
        ...regular,
        displayPrice: result.subtotal,
        compareAt: regular.displayPrice,
        maxReductionPercent: result.promotion.percentage,
        allReductionPercents: [result.promotion.percentage],
      }
    : regular;
};

import type { PricingMode } from "@louez/types";
import {
  calculateDurationMinutes,
  calculateRateBasedPrice,
  isFixedPriceProduct,
} from "@louez/utils";

import type {
  StorefrontPricingTier,
  StorefrontProductPricing,
} from "@/lib/storefront/storefront.types";
import {
  calculateCartItemPrice,
  type CartItemForPricing,
  type CartItemPriceResult,
  type CartPricingTier,
} from "@/lib/utils/cart-pricing";

/**
 * Parses a decimal the way the storefront receives it: a number, a MySQL
 * decimal string ("12.500000") or a user-typed one with a comma ("12,5").
 * Anything else is `null`, never `NaN`.
 */
export const parseStorefrontDecimal = (
  value: string | number | null | undefined,
): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = parseFloat(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

/** The pricing mode a product is billed in; `null` means the store default, a day. */
export const getStorefrontPricingMode = (
  product: Pick<StorefrontProductPricing, "pricingMode">,
): PricingMode => product.pricingMode ?? "day";

/**
 * Turns the tiers a storefront query projects into the numeric tiers the
 * cart and the server price with. A NULL `minDuration` is "from 1 period",
 * as on the server.
 */
export const normalizeStorefrontTiers = (
  tiers: readonly StorefrontPricingTier[] | null | undefined,
): CartPricingTier[] =>
  (tiers ?? []).map((tier) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent: parseStorefrontDecimal(tier.discountPercent) ?? 0,
    period: tier.period ?? null,
    price: parseStorefrontDecimal(tier.price),
  }));

const toIsoString = (value: Date | string | null | undefined): string =>
  value instanceof Date ? value.toISOString() : (value ?? "");

export interface StorefrontProductPriceInput {
  timezone?: string;
  product: StorefrontProductPricing;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  /** Defaults to 1. */
  quantity?: number;
}

/** Whether a single base rate is being extended by a partial period. */
export const isStorefrontPriceProrated = ({
  product,
  startDate,
  endDate,
}: StorefrontProductPriceInput): boolean => {
  const basePeriod = product.basePeriodMinutes;
  if (
    isFixedPriceProduct(product) ||
    product.enforceStrictTiers ||
    !basePeriod ||
    !startDate ||
    !endDate ||
    product.pricingTiers?.length ||
    product.seasonalPricings?.length
  )
    return false;

  const duration = calculateDurationMinutes(startDate, endDate);
  return duration > basePeriod && duration % basePeriod !== 0;
};

/** The cart line a product would become, for pricing only. */
export const toCartItemForPricing = ({
  product,
  startDate,
  endDate,
  quantity = 1,
  timezone,
}: StorefrontProductPriceInput): CartItemForPricing => {
  const seasonalPricings = product.seasonalPricings ?? [];

  return {
    ...(timezone ? { timezone } : {}),
    price: parseStorefrontDecimal(product.price) ?? 0,
    deposit: parseStorefrontDecimal(product.deposit) ?? 0,
    quantity,
    startDate: toIsoString(startDate),
    endDate: toIsoString(endDate),
    pricingMode: getStorefrontPricingMode(product),
    pricingKind: product.pricingKind ?? "duration",
    productPricingMode: product.pricingMode ?? null,
    basePeriodMinutes: product.basePeriodMinutes ?? null,
    enforceStrictTiers: product.enforceStrictTiers ?? false,
    pricingTiers: normalizeStorefrontTiers(product.pricingTiers),
    seasonalPricings: seasonalPricings.length > 0 ? seasonalPricings : undefined,
  };
};

/**
 * Display price of a product for a period and quantity, computed by the
 * same path as the cart (`calculateCartItemPrice`), so a card, the product
 * page, the cart and the server use the same billing mode. Without
 * dates it is the base price times the quantity.
 */
export const getStorefrontProductPrice = (
  input: StorefrontProductPriceInput,
): CartItemPriceResult => calculateCartItemPrice(toCartItemForPricing(input), null, null);

export type StorefrontBillingDetail =
  | { mode: "prorated" }
  | { mode: "package"; periodMinutes: number; count: number }
  | { mode: "rate"; periodMinutes: number };

/** Explain the rate selected by the price engine, without turning it into a discount. */
export const getStorefrontBillingDetail = (
  item: CartItemForPricing,
  priceResult: CartItemPriceResult,
  globalStartDate?: string | null,
  globalEndDate?: string | null,
): StorefrontBillingDetail | null => {
  const start = globalStartDate || item.startDate;
  const end = globalEndDate || item.endDate;
  const basePeriodMinutes = item.basePeriodMinutes;
  if (
    isFixedPriceProduct(item) ||
    !basePeriodMinutes ||
    basePeriodMinutes <= 0 ||
    !start ||
    !end ||
    (priceResult.seasonalSegments?.length ?? 0) > 1
  )
    return null;

  const durationMinutes = calculateDurationMinutes(start, end);
  if (!Number.isFinite(durationMinutes)) return null;
  const season = item.seasonalPricings?.find(
    (season) => season.id === priceResult.seasonalSegments?.[0]?.seasonalPricingId,
  );
  const rates =
    season?.rates ??
    (item.pricingTiers ?? []).flatMap((tier, index) =>
      typeof tier.period === "number" &&
      tier.period > 0 &&
      typeof tier.price === "number" &&
      tier.price >= 0
        ? [{ id: tier.id, period: tier.period, price: tier.price, displayOrder: index }]
        : [],
    );
  const result = calculateRateBasedPrice(
    {
      basePrice: season?.basePrice ?? item.price,
      basePeriodMinutes,
      deposit: 0,
      rates,
      enforceStrictTiers: item.enforceStrictTiers ?? false,
    },
    durationMinutes,
    1,
  );
  if (!result.appliedRate) return null;
  if (item.enforceStrictTiers) {
    return { mode: "package", periodMinutes: result.appliedRate.period, count: result.periodsUsed };
  }
  return durationMinutes <= result.appliedRate.period
    ? { mode: "rate", periodMinutes: result.appliedRate.period }
    : { mode: "prorated" };
};

import type { PricingMode } from "@louez/types";
import { calculateDurationMinutes, isFixedPriceProduct } from "@louez/utils";

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

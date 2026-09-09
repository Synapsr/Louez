import { z } from "zod";

import type { AddCartItemInput } from "@/contexts/cart-context";
import type { RequiredAccessoryCartInput } from "@/lib/utils/cart-required-accessories";
import type { CartResolutionLine } from "@/lib/utils/util.cart-lines";

/**
 * Pure half of the advisor's `add_to_cart` tool: input parsing, the one
 * business rule the client enforces (one rental period per cart) and the
 * mapping from a server-resolved line to what the cart accepts. The
 * network calls stay in the context so this stays testable.
 */

const advisorAddToCartInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
  startDate: z.string(),
  endDate: z.string(),
});

export interface AdvisorAddToCartRequest {
  productId: string;
  quantity: number;
  /** Strict ISO 8601 with offset, as the cart endpoints require. */
  startDate: string;
  endDate: string;
}

export type AdvisorAddToCartParseResult =
  | { ok: true; request: AdvisorAddToCartRequest }
  | { ok: false; reason: "invalid_input" | "invalid_dates" };

/**
 * Validates the model's tool input. Models sometimes emit datetimes without
 * a timezone offset: both dates are re-serialised as strict ISO so the
 * cart endpoint never sees an ambiguous value.
 */
export const parseAdvisorAddToCartInput = (rawInput: unknown): AdvisorAddToCartParseResult => {
  const parsed = advisorAddToCartInputSchema.safeParse(rawInput);

  if (!parsed.success) {
    return { ok: false, reason: "invalid_input" };
  }

  const startMs = Date.parse(parsed.data.startDate);
  const endMs = Date.parse(parsed.data.endDate);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return { ok: false, reason: "invalid_dates" };
  }

  return {
    ok: true,
    request: {
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      startDate: new Date(startMs).toISOString(),
      endDate: new Date(endMs).toISOString(),
    },
  };
};

export interface CartPeriodSnapshot {
  hasItems: boolean;
  startDate: string | null;
  endDate: string | null;
}

/**
 * The cart has one rental period. Adding with other dates to a non-empty
 * cart is a conflict the model must resolve with the customer, never a
 * silent override. Returns the cart period when it conflicts, else null.
 */
export const findCartPeriodConflict = (
  cart: CartPeriodSnapshot,
  request: Pick<AdvisorAddToCartRequest, "startDate" | "endDate">,
): { cartStartDate: string; cartEndDate: string } | null => {
  if (!cart.hasItems || !cart.startDate || !cart.endDate) {
    return null;
  }

  const sameStart = Date.parse(cart.startDate) === Date.parse(request.startDate);
  const sameEnd = Date.parse(cart.endDate) === Date.parse(request.endDate);

  return sameStart && sameEnd ? null : { cartStartDate: cart.startDate, cartEndDate: cart.endDate };
};

export type ResolvedCartLine = Extract<CartResolutionLine, { status: "resolved" }>;

/**
 * The cart line for a server-resolved product: price, stock and pricing
 * rules come from the resolution, the quantity and period from the request.
 */
export const toAdvisorCartLine = (
  line: ResolvedCartLine,
  request: AdvisorAddToCartRequest,
  requiredAccessories: RequiredAccessoryCartInput[],
): AddCartItemInput => ({
  productId: line.productId,
  productName: line.productName,
  productImage: line.productImage,
  price: line.price,
  deposit: line.deposit,
  quantity: request.quantity,
  maxQuantity: line.maxQuantity,
  pricingKind: line.pricingKind,
  pricingTiers: line.pricingTiers,
  basePeriodMinutes: line.basePeriodMinutes,
  enforceStrictTiers: line.enforceStrictTiers,
  productPricingMode: line.productPricingMode,
  seasonalPricings: line.seasonalPricings,
  requiredAccessories,
  startDate: request.startDate,
  endDate: request.endDate,
});

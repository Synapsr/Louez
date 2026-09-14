import type { CartItemPriceResult } from "@/lib/utils/cart-pricing";

/**
 * The store can cap the discount percentage it is willing to advertise.
 * Above that cap, the storefront shows the discounted price as the plain
 * price: no badge, no strikethrough, no "you save" line. Shoppers who see a
 * huge markdown tend to distrust the price rather than celebrate it.
 *
 * `maxDiscountPercent` is null/undefined when the cap is disabled.
 */
export function isDiscountDisplayable(
  reductionPercent: number | null | undefined,
  maxDiscountPercent: number | null | undefined,
): boolean {
  if (reductionPercent == null || reductionPercent <= 0) return false;
  return maxDiscountPercent == null || reductionPercent <= maxDiscountPercent;
}

/**
 * Only advertise an explicit discount. The engine also compares ordinary
 * duration rates with repeated base periods; that difference is not a promotion.
 */
export function getEffectiveDiscountPercent(
  priceResult: Pick<CartItemPriceResult, "savings" | "originalSubtotal" | "discountPercent">,
): number {
  return priceResult.discountPercent ?? 0;
}

export interface DisplayableSavings {
  /** Sum of the savings the store is willing to advertise. */
  savings: number;
  /** Subtotal before those advertised savings only; hidden ones stay folded into the price. */
  originalSubtotal: number;
}

/**
 * Cart-level totals for the summary blocks. A line whose discount exceeds the
 * cap contributes its discounted price as if it were the list price, so the
 * "subtotal / discount / you save" rows never reveal a hidden markdown.
 */
export function getDisplayableSavings(
  priceResults: Pick<
    CartItemPriceResult,
    "subtotal" | "savings" | "originalSubtotal" | "discountPercent"
  >[],
  maxDiscountPercent: number | null | undefined,
): DisplayableSavings {
  return priceResults.reduce<DisplayableSavings>(
    (acc, result) => {
      const displayable = isDiscountDisplayable(
        getEffectiveDiscountPercent(result),
        maxDiscountPercent,
      );
      return {
        savings: acc.savings + (displayable ? result.savings : 0),
        originalSubtotal:
          acc.originalSubtotal + (displayable ? result.originalSubtotal : result.subtotal),
      };
    },
    { savings: 0, originalSubtotal: 0 },
  );
}

/**
 * Discount a product card may advertise: the highest tier percentage at or
 * below the store cap, or the highest of all when the cap is disabled. Zero
 * when every discount is hidden.
 */
export function getDisplayableMaxDiscount(
  summary: { maxReductionPercent: number; allReductionPercents: number[] },
  maxDiscountPercent: number | null | undefined,
): number {
  if (maxDiscountPercent == null) return summary.maxReductionPercent;
  return Math.max(
    ...summary.allReductionPercents.filter((percent) => percent <= maxDiscountPercent),
    0,
  );
}

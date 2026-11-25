import type { UnitAttributes } from "@louez/types";
import { leavesChoiceOpen, readLineChoice, type LineChoice } from "@louez/utils";

type ChoiceProduct = Parameters<typeof readLineChoice>[0];

interface CheckoutLine {
  productId: string;
  selectedAttributes?: UnitAttributes;
  resolvedCombinationKey?: string;
  resolvedAttributes?: UnitAttributes;
}

/**
 * The choice a checkout line leaves open, read against its product under the
 * lock, or null. A line that leaves a size or a colour open on a product
 * whose units are tracked books no combination: any matching unit serves it,
 * the store picks it, and only the values the customer chose are recorded
 * (`readLineChoice`, as the store's own bookings).
 */
export const openChoiceOf = (
  item: CheckoutLine,
  product: ChoiceProduct | undefined,
): LineChoice | null => {
  if (!product) return null;
  const choice = readLineChoice(product, item.selectedAttributes);
  return leavesChoiceOpen(product, choice) ? choice : null;
};

/** The line as the stock check reads it: an open line is served by any matching unit. */
export const toInventoryLine = <T extends CheckoutLine>(item: T, open: LineChoice | null) =>
  open
    ? {
        ...item,
        selectedAttributes: open.selectedAttributes ?? undefined,
        combinationKey: null,
        pooled: true,
      }
    : item;

/**
 * The choice a line is written with: its open choice, or the combination the
 * stock check gave it (the one the checkout resolved, failing that).
 */
export const bookedChoiceOf = (
  item: CheckoutLine,
  open: LineChoice | null,
  resolved: { combinationKey: string; selectedAttributes: UnitAttributes } | undefined,
): LineChoice =>
  open ?? {
    combinationKey: resolved?.combinationKey || item.resolvedCombinationKey || null,
    selectedAttributes:
      resolved?.selectedAttributes || item.resolvedAttributes || item.selectedAttributes || null,
  };

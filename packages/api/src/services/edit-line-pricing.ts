import type { PricingBreakdown, ProductTaxSettings } from "@louez/types";

/**
 * The line prices of a reservation the store edits from the dashboard
 * (docs/domain/reservation-changes.md, slice 11): which product lines are
 * priced again, and from what. One function for the server
 * (`updateReservation`) and the edit form's preview, so the form shows what
 * the server writes.
 *
 * Pure, with no runtime import.
 */

/** A line priced from its product (no price typed by hand), as it is stored before the edit. */
export interface StoredProductLine {
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /** Its recorded tax rate; null when it recorded none. */
  taxRate: number | null;
  pricingBreakdown: PricingBreakdown | null;
}

export type EditedProductLinePrice =
  /** Its stored price stands: unit price, total, breakdown and tax rate as they were. */
  | { kind: "kept"; subtotal: number; unitPrice: number; taxRate: number | null }
  /** Priced again, by the rules the edit prices a line with. */
  | { kind: "repriced" };

/**
 * A line the edit does not change keeps its price: an existing line priced
 * from its product, at the same quantity, over the same window. Whatever the
 * catalogue, its tiers, its seasons, a promotion or the tax settings did
 * since, its unit price, total and breakdown are those stored. Only a line
 * that changed, or every line when the window changed, is priced again.
 *
 * `stored` is the line as stored when it was priced from its product before
 * too; null for a new line, or one whose price was typed by hand.
 */
export function priceEditedProductLine(input: {
  stored: StoredProductLine | null;
  quantity: number;
  windowChanged: boolean;
}): EditedProductLinePrice {
  const { stored } = input;
  if (stored && stored.quantity === input.quantity && !input.windowChanged) {
    return {
      kind: "kept",
      subtotal: stored.totalPrice,
      unitPrice: stored.unitPrice,
      taxRate: stored.taxRate,
    };
  }
  return { kind: "repriced" };
}

/**
 * The tax settings the engine prices a line with: the rate the line recorded
 * when it keeps its stored price, so its tax figures stay as they were
 * whatever the store's rates did since; else its product's, as for any line.
 */
export const editedLineTaxSettings = (
  keptTaxRate: number | null,
  productTaxSettings: ProductTaxSettings | null | undefined,
): ProductTaxSettings | null =>
  keptTaxRate !== null
    ? { inheritFromStore: false, customRate: keptTaxRate }
    : (productTaxSettings ?? null);

import type { AppliedProductPromotion, PricingBreakdown, ProductTaxSettings } from "@louez/types";

import { NOT_RECORDED, pricingBasisOf, recordedPromotion } from "./pricing-facts";

/**
 * The line prices of a reservation the store edits from the dashboard
 * (docs/domain/reservation-changes.md, slice 11): which product lines are
 * priced again, and from what. One function for the server
 * (`updateReservation`) and the edit form's preview, so the form shows what
 * the server writes.
 *
 * Pure: it reads no store and no catalogue.
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

/**
 * A stored line priced from its product, as the edit reads it, from its row
 * or from the edit form's copy of it; null for one whose price was typed by
 * hand.
 */
export function storedProductLineOf(item: {
  quantity: number;
  unitPrice: string | number;
  totalPrice: string | number;
  taxRate: string | number | null;
  pricingBreakdown: PricingBreakdown | null;
}): StoredProductLine | null {
  if (pricingBasisOf(item.pricingBreakdown)?.isManualOverride === true) return null;
  return {
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    totalPrice: Number(item.totalPrice),
    taxRate: item.taxRate === null ? null : Number(item.taxRate),
    pricingBreakdown: item.pricingBreakdown,
  };
}

/**
 * The tax a line of an edit is priced with:
 *
 * - `recorded`: it keeps its stored price and recorded a rate: that rate,
 *   whatever the store's rates did since;
 * - `not_recorded`: it keeps its stored price and recorded no rate: it has no
 *   tax fact to keep, and is taxed by today's settings, as slice 10 prices a
 *   reservation without tax facts (the store is warned when that adds tax to
 *   it, `errors.editTaxAdded`);
 * - `today`: it is priced again (or new): today's settings, as any line.
 */
export type EditedLineTax =
  | { kind: "recorded"; rate: number }
  | { kind: "not_recorded" }
  | { kind: "today" };

export const TAX_OF_TODAY: EditedLineTax = { kind: "today" };

export type EditedProductLinePrice =
  /** Its stored price stands: unit price, total and breakdown as they were; its tax as `tax` says. */
  | { kind: "kept"; subtotal: number; unitPrice: number; tax: EditedLineTax }
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
      tax:
        stored.taxRate === null
          ? { kind: "not_recorded" }
          : { kind: "recorded", rate: stored.taxRate },
    };
  }
  return { kind: "repriced" };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A promotion applied as recorded on the line: its percentage taken off the
 * line's new price, as the checkout takes a promotion off
 * (`applyProductPromotion`), whether the promotion is still in force or not.
 */
export function applyRecordedPromotion(
  subtotal: number,
  promotion: Pick<AppliedProductPromotion, "percentage">,
): { subtotal: number; promotion: AppliedProductPromotion } {
  const originalSubtotal = round2(subtotal);
  const discountAmount = Math.round(originalSubtotal * promotion.percentage) / 100;
  return {
    subtotal: round2(originalSubtotal - discountAmount),
    promotion: { percentage: promotion.percentage, originalSubtotal, discountAmount },
  };
}

/**
 * The price of a line priced again from today's catalogue (`regular`, its
 * price and breakdown before any promotion), with what the line recorded at
 * booking (slice 9's facts): its promotion is applied as recorded, never
 * looked up again in today's catalogue and never dropped, so a booking made
 * during a promotion keeps it when its window or quantity changes, after the
 * promotion ended too. A recorded "none" stays recorded. A line that recorded
 * nothing (a new line, an older row) is priced without one, as before.
 */
export function cataloguePriceWithRecordedPromotion(
  regular: { subtotal: number; breakdown: PricingBreakdown },
  stored: StoredProductLine | null,
): {
  subtotal: number;
  breakdown: PricingBreakdown;
  /** The promotion applied, to apply again under the locks; null for none. */
  promotion: AppliedProductPromotion | null;
} {
  const priced = subtotalWithRecordedPromotion(regular.subtotal, stored);
  if (priced.recorded === NOT_RECORDED) {
    return { subtotal: regular.subtotal, breakdown: regular.breakdown, promotion: null };
  }
  return {
    subtotal: priced.subtotal,
    breakdown: { ...regular.breakdown, promotion: priced.promotion },
    promotion: priced.promotion,
  };
}

/** The new price of a line with the promotion it recorded, and what it recorded. */
export function subtotalWithRecordedPromotion(
  subtotal: number,
  stored: StoredProductLine | null,
): {
  subtotal: number;
  promotion: AppliedProductPromotion | null;
  recorded: AppliedProductPromotion | null | typeof NOT_RECORDED;
} {
  const recorded = stored ? recordedPromotion(stored) : NOT_RECORDED;
  if (recorded === NOT_RECORDED || recorded === null) {
    return { subtotal, promotion: null, recorded };
  }
  const applied = applyRecordedPromotion(subtotal, recorded);
  return { subtotal: applied.subtotal, promotion: applied.promotion, recorded };
}

export type ProductGoneLinePrice =
  | { kind: "priced"; subtotal: number; unitPrice: number; breakdown: PricingBreakdown | null }
  /** A duration-priced line whose window moved: no price follows from what it recorded. */
  | { kind: "refused" };

/**
 * A line whose product was deleted since, which the edit changes (an
 * untouched one keeps its price, `priceEditedProductLine`). Nothing prices it
 * any more but what it stored:
 *
 * - a fixed-price line (`pricingKind: "fixed"`) whose window moved, at the
 *   same quantity: kept as stored, its unit price, total and breakdown; a
 *   fixed price does not depend on the window;
 * - its quantity changed, the window as it was, or a fixed-price line whose
 *   quantity changed: its stored total in proportion to the quantities,
 *   rounded once, its stored unit price and breakdown left as they are;
 * - a line priced by its duration whose window moved: refused, always. The
 *   store types the line's price by hand, then changes the dates.
 */
export function priceProductGoneLine(input: {
  stored: StoredProductLine | null;
  quantity: number;
  windowChanged: boolean;
}): ProductGoneLinePrice {
  const { stored } = input;
  if (!stored || stored.quantity <= 0) return { kind: "refused" };
  const fixed = stored.pricingBreakdown?.pricingKind === "fixed";
  if (input.windowChanged && !fixed) return { kind: "refused" };
  return {
    kind: "priced",
    subtotal:
      input.quantity === stored.quantity
        ? stored.totalPrice
        : round2((stored.totalPrice * input.quantity) / stored.quantity),
    unitPrice: stored.unitPrice,
    breakdown: stored.pricingBreakdown,
  };
}

/**
 * The tax settings the engine prices a line with (`EditedLineTax`): the rate
 * it recorded when it keeps its stored price and recorded one; else its
 * product's, as for any line.
 */
export const editedLineTaxSettings = (
  tax: EditedLineTax,
  productTaxSettings: ProductTaxSettings | null | undefined,
): ProductTaxSettings | null =>
  tax.kind === "recorded"
    ? { inheritFromStore: false, customRate: tax.rate }
    : (productTaxSettings ?? null);

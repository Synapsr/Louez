import type { AppliedProductPromotion, PricingBreakdown, ProductTaxSettings } from "@louez/types";
import { calculateDuration } from "@louez/utils";

import { NOT_RECORDED, recordedPromotion } from "./pricing-facts";

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
  const recorded = stored ? recordedPromotion(stored) : NOT_RECORDED;
  if (recorded === NOT_RECORDED) {
    return { subtotal: regular.subtotal, breakdown: regular.breakdown, promotion: null };
  }
  if (recorded === null) {
    return {
      subtotal: regular.subtotal,
      breakdown: { ...regular.breakdown, promotion: null },
      promotion: null,
    };
  }
  const applied = applyRecordedPromotion(regular.subtotal, recorded);
  return {
    subtotal: applied.subtotal,
    breakdown: { ...regular.breakdown, promotion: applied.promotion },
    promotion: applied.promotion,
  };
}

export type ProductGoneLinePrice =
  | {
      kind: "priced";
      subtotal: number;
      unitPrice: number;
      breakdown: PricingBreakdown | null;
      /** Its window moved: priced from its booked price per period, now a price typed by hand. */
      scaled: boolean;
    }
  /** Its window moved and its booked duration was not recorded: no price follows from what it recorded. */
  | { kind: "refused" };

/**
 * A line whose product was deleted since, which the edit changes (an
 * untouched one keeps its price, `priceEditedProductLine`). Its stored unit
 * price is the whole period's price per unit, so it is never multiplied by
 * the duration again. It follows what it recorded:
 *
 * - its quantity changed, the window as it was: the same price per unit;
 * - its window moved: its price per period, its stored total divided by the
 *   duration and quantity it recorded, over the new duration; the line then
 *   holds a price typed by hand, and the store is told (`scaled`). A
 *   fixed-price line keeps its price per unit;
 * - its window moved and no duration recorded: refused, never another price.
 */
export function priceProductGoneLine(input: {
  stored: StoredProductLine | null;
  quantity: number;
  windowChanged: boolean;
  window: { start: Date; end: Date };
}): ProductGoneLinePrice {
  const { stored } = input;
  if (!stored || stored.quantity <= 0) return { kind: "refused" };
  // What the line recorded of its pricing: a breakdown written only to record
  // facts (slice 9) records its duration and mode too.
  const recorded = stored.pricingBreakdown;
  if (!input.windowChanged || recorded?.pricingKind === "fixed") {
    const perUnit = round2(stored.totalPrice / stored.quantity);
    return {
      kind: "priced",
      subtotal: round2(perUnit * input.quantity),
      unitPrice: perUnit,
      breakdown: stored.pricingBreakdown,
      scaled: false,
    };
  }
  if (!recorded || !(recorded.duration > 0) || !recorded.pricingMode) return { kind: "refused" };
  const perPeriod = round2(stored.totalPrice / (recorded.duration * stored.quantity));
  const duration = calculateDuration(input.window.start, input.window.end, recorded.pricingMode);
  // A price typed by hand from now on, read as one by later edits.
  const { factsOnly: _factsOnly, ...basis } = recorded;
  return {
    kind: "priced",
    subtotal: round2(perPeriod * duration * input.quantity),
    unitPrice: perPeriod,
    breakdown: {
      ...basis,
      basePrice: perPeriod,
      effectivePrice: perPeriod,
      duration,
      isManualOverride: true,
    },
    scaled: true,
  };
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

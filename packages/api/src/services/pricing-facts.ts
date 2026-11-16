import type { AppliedProductPromotion, PricingBreakdown, TaxSettings } from "@louez/types";

/**
 * The facts a reservation was priced with (docs/domain/reservation-changes.md,
 * slice 9; M3): the tax display mode on the reservation, the exemption and the
 * promotion on each line. A fact that was not recorded reads as
 * `"not_recorded"`, never as zero, false or none: rows written before
 * migration 0107 hold none, nor does a line's promotion where its creator
 * did not price it with the checkout's engine (the dashboard's creation and
 * edit, a custom line).
 *
 * Pure, with no runtime import.
 */
export const NOT_RECORDED = "not_recorded" as const;
export type Recorded<T> = T | typeof NOT_RECORDED;

export type TaxDisplayMode = "inclusive" | "exclusive";

/**
 * The display mode the tax engine prices with for these settings: the store's
 * when taxes are on, else `inclusive` (prices are the totals), as
 * `computeReservationTotals` reads them. What a creator records.
 */
export const taxDisplayModeOf = (settings: TaxSettings | undefined | null): TaxDisplayMode =>
  settings?.enabled ? settings.displayMode : "inclusive";

/** How the reservation's prices were entered, tax included or not. */
export const recordedTaxDisplayMode = (reservation: {
  taxDisplayMode: TaxDisplayMode | null;
}): Recorded<TaxDisplayMode> => reservation.taxDisplayMode ?? NOT_RECORDED;

/** Whether the line is outside the tax by rule (insurance). */
export const recordedTaxExempt = (item: { taxExempt: boolean | null }): Recorded<boolean> =>
  item.taxExempt ?? NOT_RECORDED;

/**
 * The promotion the line's price applied: the promotion, or `null` when none
 * did. A breakdown without the `promotion` key, or no breakdown, did not
 * record it.
 */
export const recordedPromotion = (item: {
  pricingBreakdown: PricingBreakdown | null;
}): Recorded<AppliedProductPromotion | null> =>
  item.pricingBreakdown && "promotion" in item.pricingBreakdown
    ? (item.pricingBreakdown.promotion ?? null)
    : NOT_RECORDED;

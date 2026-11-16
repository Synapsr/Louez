import { storedProductLineOf } from "@louez/api/services/edit-line-pricing";
import { pricingBasisOf } from "@louez/api/services/pricing-facts";
import type { PricingMode } from "@louez/types";
import { minutesToPriceDuration } from "@louez/utils";

import { calculateDuration } from "@/lib/utils/duration";

import { calculateUnitPriceFromTotal } from "../hooks/use-edit-reservation-pricing";

import type { EditableItem, ReservationItem } from "../types";

/**
 * The edit form's lines: a stored line as the form reads it, and a line as
 * the form sends it to `updateReservation`.
 */

const resolvePricingModeFromMinutes = (
  periodMinutes: number | null | undefined,
  fallback: PricingMode,
): PricingMode => {
  if (!periodMinutes || periodMinutes <= 0) {
    return fallback;
  }

  const period = minutesToPriceDuration(periodMinutes);
  if (period.unit === "week") return "week";
  if (period.unit === "day") return "day";
  return "hour";
};

const resolveInitialManualPricingMode = (
  product: EditableItem["product"],
  fallback: PricingMode,
  startDate: Date,
  endDate: Date,
): PricingMode => {
  if (!product?.basePeriodMinutes || product.basePeriodMinutes <= 0) {
    return fallback;
  }

  const durationMinutes = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60)),
  );
  const periods = [
    product.basePeriodMinutes,
    ...product.pricingTiers.map((tier) => tier.period ?? null),
  ]
    .filter((period): period is number => typeof period === "number" && period > 0)
    .sort((a, b) => a - b);

  if (periods.length === 0) {
    return fallback;
  }

  const applicablePeriod =
    [...periods].reverse().find((period) => period <= durationMinutes) ?? periods[0];

  return resolvePricingModeFromMinutes(applicablePeriod, fallback);
};

const toPricingMode = (value: unknown): PricingMode | null =>
  value === "hour" || value === "day" || value === "week" ? value : null;

/**
 * A stored line as the form reads it. Its price is typed by hand when, and
 * only when, its breakdown says so (`isManualOverride`); a typed price is read
 * back per period over the stored window.
 */
export const toEditableItem = (
  item: ReservationItem,
  startDate: Date,
  endDate: Date,
): EditableItem => {
  // A breakdown written only to record facts is read as none, as before (slice 9).
  const pricingBasis = pricingBasisOf(item.pricingBreakdown);
  const isManualPrice = pricingBasis?.isManualOverride === true;
  const fallbackPricingMode =
    toPricingMode(item.product?.pricingMode) ?? pricingBasis?.pricingMode ?? "day";
  const pricingMode = isManualPrice
    ? resolveInitialManualPricingMode(item.product, fallbackPricingMode, startDate, endDate)
    : fallbackPricingMode;
  const duration =
    item.product?.pricingKind === "fixed" ? 1 : calculateDuration(startDate, endDate, pricingMode);
  const preciseManualUnitPrice =
    isManualPrice && item.quantity > 0 && duration > 0
      ? Number(item.totalPrice) / (duration * item.quantity)
      : Number(item.unitPrice);

  return {
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    consumedQuantity: item.consumedQuantity,
    unitPrice: preciseManualUnitPrice,
    depositPerUnit: parseFloat(item.depositPerUnit),
    isManualPrice,
    pricingMode,
    basePeriodMinutes: item.product?.basePeriodMinutes ?? null,
    enforceStrictTiers: item.product?.enforceStrictTiers ?? false,
    productSnapshot: item.productSnapshot,
    product: item.product,
    stored: item.productId ? storedProductLineOf(item) : null,
  };
};

/** A line as the form sends it to `updateReservation`. */
export const toReservationItemPayload = (item: EditableItem) => ({
  id: item.id.startsWith("new-") || item.id.startsWith("custom-") ? undefined : item.id,
  productId: item.productId,
  quantity: item.quantity,
  unitPrice: item.unitPrice,
  depositPerUnit: item.depositPerUnit,
  isManualPrice: item.isManualPrice,
  pricingMode: item.pricingMode,
  productSnapshot: {
    name: item.productSnapshot.name,
    description: item.productSnapshot.description ?? null,
  },
});

/**
 * Two prices the price field shows alike. The field writes a price with
 * `toFixed(2)` and commits what it wrote, so the comparison is made on that
 * same text: 2.675 is shown, and committed, as 2.67.
 */
const sameShownPrice = (a: number, b: number) => a.toFixed(2) === b.toFixed(2);

/**
 * A unit price committed by the line's price field. The field commits on
 * every blur: a commit of the price it showed types nothing, and the line
 * keeps how it is priced (from its product, or as typed). Only another price
 * is a price typed by hand, per `pricingMode` period.
 */
export const withUnitPriceCommitted = (
  item: EditableItem,
  committed: { price: number; shownUnitPrice: number; pricingMode: PricingMode },
): EditableItem =>
  sameShownPrice(committed.price, committed.shownUnitPrice)
    ? item
    : {
        ...item,
        unitPrice: committed.price,
        isManualPrice: true,
        pricingMode: committed.pricingMode,
      };

/**
 * A line total committed by the line's total field: as for the unit price, a
 * commit of the total it showed types nothing; another total is typed, read
 * back as a unit price per `pricingMode` period over `duration` of them.
 */
export const withTotalPriceCommitted = (
  item: EditableItem,
  committed: {
    totalPrice: number;
    shownTotalPrice: number;
    pricingMode: PricingMode;
    duration: number;
  },
): EditableItem => {
  if (sameShownPrice(committed.totalPrice, committed.shownTotalPrice)) return item;
  const unitPrice = calculateUnitPriceFromTotal({
    totalPrice: committed.totalPrice,
    quantity: item.quantity,
    duration: committed.duration,
    pricingKind: item.product?.pricingKind ?? "duration",
  });
  return { ...item, unitPrice, isManualPrice: true, pricingMode: committed.pricingMode };
};

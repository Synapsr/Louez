import { useMemo } from "react";
import { useStoreTimezone } from "@/contexts/store-context";

import {
  editedLineTaxSettings,
  priceEditedProductLine,
  priceProductGoneLine,
  subtotalWithRecordedPromotion,
  TAX_OF_TODAY,
  type EditedLineTax,
} from "@louez/api/services/edit-line-pricing";
import { priceCatalogLine } from "@louez/api/services/catalogue-line-pricing";
import { taxSettingsForRepricing, type TaxDisplayMode } from "@louez/api/services/pricing-facts";
import { computeReservationTotals } from "@louez/api/services/reservation-totals";
import type { PricingKind, PricingMode, TaxSettings } from "@louez/types";
import {
  calculateDurationMinutes,
  isRateBasedProduct,
  minutesToPriceDuration,
  roundToMinorUnit,
} from "@louez/utils";

import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import { calculateDuration } from "@/lib/utils/duration";
import { getEffectiveDiscountPercent } from "@/lib/utils/util.discount-visibility";

import type {
  CalculatedEditableItem,
  EditableItem,
  Product,
  ReservationCalculations,
} from "../types";
import { isAddedLine } from "../utils/editable-items";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateUnitPriceFromTotal(params: {
  totalPrice: number;
  quantity: number;
  duration: number;
  pricingKind: PricingKind;
}): number {
  const effectiveDuration = params.pricingKind === "fixed" ? 1 : params.duration;
  return effectiveDuration > 0 && params.quantity > 0
    ? params.totalPrice / (effectiveDuration * params.quantity)
    : params.totalPrice;
}

/**
 * Build a human-readable label for the applied pricing discount.
 *
 * For rate-based products we show the percentage saved.
 * For tier-based products we show the tier threshold (e.g. "-20% (7+ j)").
 */
function buildTierLabel(
  item: EditableItem,
  discountPercent: number | null,
  duration: number,
): string | null {
  if (!discountPercent || discountPercent <= 0) return null;

  // Rate-based: just show the percentage
  if (isRateBasedProduct({ basePeriodMinutes: item.basePeriodMinutes })) {
    return `-${Math.round(discountPercent)}%`;
  }

  // Tier-based: find which tier was applied and show threshold
  const tiers = item.product?.pricingTiers;
  if (!tiers?.length) return `-${Math.round(discountPercent)}%`;

  const mode = item.pricingMode;
  const unit = mode === "hour" ? "h" : mode === "week" ? "sem" : "j";

  // Find the highest tier that applies to this duration
  const applicableTier = [...tiers]
    .sort((a, b) => b.minDuration - a.minDuration)
    .find((t) => duration >= t.minDuration);

  if (applicableTier && applicableTier.discountPercent > 0) {
    return `-${Math.round(applicableTier.discountPercent)}% (${applicableTier.minDuration}+ ${unit})`;
  }

  return `-${Math.round(discountPercent)}%`;
}

/**
 * Calculate the price for a single editable item, as the server prices it
 * (slice 11, `@louez/api/services/edit-line-pricing`): a line priced from its
 * product that the edit does not change keeps its stored price; priced again,
 * it goes through `calculateCartItemPrice` (seasonal, rate-based, tier-based
 * and fixed pricing), with the promotion it recorded; a line whose product
 * is gone follows what it recorded. A line the edit adds is priced as the
 * server prices it (`priceCatalogLine`, on the product as the server's
 * catalogue holds it), with the promotion in force at `pricedAt`, the
 * server's instant. Manual-price items use the user-set unit price
 * directly. `windowChanged`: the window is not the one stored.
 */
export function calculateEditableItemPrice(
  item: EditableItem,
  startDate: Date,
  endDate: Date,
  timezone?: string,
  windowChanged = false,
  /** The reservation's currency: a typed price's total rounded once in its minor unit, as the server rounds it. */
  currency?: string,
  /** The server's instant: a line the edit adds takes the promotion in force at it. */
  pricedAt?: Date,
): {
  totalPrice: number;
  effectiveUnitPrice: number;
  displayPricingMode: PricingMode;
  tierLabel: string | null;
  discount: number;
  originalSubtotal: number;
  savings: number;
  discountPercent: number | null;
  duration: number;
  displayDuration: number;
  tax: EditedLineTax;
} {
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

  const resolveRateDisplayPricingMode = (
    targetMinutes: number,
    fallback: PricingMode,
  ): PricingMode => {
    const periods = [
      item.product?.basePeriodMinutes ?? null,
      ...(item.product?.pricingTiers ?? []).map((tier) => tier.period ?? null),
    ]
      .filter((period): period is number => typeof period === "number" && period > 0)
      .sort((a, b) => a - b);

    if (periods.length === 0) {
      return fallback;
    }

    const applicablePeriod =
      [...periods].reverse().find((period) => period <= targetMinutes) ?? periods[0];

    return resolvePricingModeFromMinutes(applicablePeriod, fallback);
  };

  const mode = item.pricingMode;
  const duration =
    item.product?.pricingKind === "fixed" ? 1 : calculateDuration(startDate, endDate, mode);

  // A line priced from its product, kept at its stored price, or its product gone.
  if (!item.isManualPrice && item.productId) {
    const kept = priceEditedProductLine({
      stored: item.stored,
      quantity: item.quantity,
      windowChanged,
    });
    const gone =
      kept.kind === "kept" || item.product
        ? null
        : priceProductGoneLine({
            stored: item.stored,
            quantity: item.quantity,
            windowChanged,
          });
    if (kept.kind === "kept" || gone) {
      // A line the server refuses (its product gone, priced by its duration, its window moved) is written nothing.
      const totalPrice =
        kept.kind === "kept"
          ? kept.subtotal
          : gone?.kind === "priced"
            ? gone.subtotal
            : (item.stored?.totalPrice ?? 0);
      return {
        totalPrice,
        effectiveUnitPrice:
          duration > 0 && item.quantity > 0 ? totalPrice / duration / item.quantity : totalPrice,
        displayPricingMode: item.pricingMode,
        tierLabel: null,
        discount: 0,
        originalSubtotal: totalPrice,
        savings: 0,
        discountPercent: null,
        duration,
        displayDuration: duration,
        tax: kept.kind === "kept" ? kept.tax : TAX_OF_TODAY,
      };
    }
  }

  // Manual price or custom item (no product): simple multiplication
  if (item.isManualPrice || !item.product) {
    const totalPrice = roundToMinorUnit(item.unitPrice * duration * item.quantity, currency);
    return {
      totalPrice,
      effectiveUnitPrice: item.unitPrice,
      displayPricingMode: item.pricingMode,
      tierLabel: null,
      discount: 0,
      originalSubtotal: totalPrice,
      savings: 0,
      discountPercent: null,
      duration,
      displayDuration: duration,
      tax: TAX_OF_TODAY,
    };
  }

  const product = item.product;
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  const durationMinutes = calculateDurationMinutes(startDate, endDate);
  // A line the edit adds: the server's price, the promotion in force at the server's instant.
  const added =
    isAddedLine(item) && pricedAt
      ? priceCatalogLine(
          { ...product.catalogue, ...(timezone ? { timezone } : {}) },
          { productId: product.id, quantity: item.quantity, startDate: startIso, endDate: endIso },
          pricedAt,
        )
      : null;

  // Delegate to the shared pricing utility — same logic as the storefront
  const result = calculateCartItemPrice(
    {
      timezone,
      // What the line shows of a promotion: only a line the edit adds takes today's.
      promotion: added ? product.catalogue.promotion : null,
      price: parseFloat(product.price),
      deposit: parseFloat(product.deposit),
      quantity: item.quantity,
      startDate: startIso,
      endDate: endIso,
      pricingMode: mode,
      pricingKind: product.pricingKind,
      productPricingMode: (product.pricingMode as PricingMode) ?? mode,
      basePeriodMinutes: product.basePeriodMinutes ?? null,
      enforceStrictTiers: product.enforceStrictTiers ?? false,
      pricingTiers: product.pricingTiers.map((t) => ({
        id: t.id,
        minDuration: t.minDuration,
        discountPercent: t.discountPercent,
        period: t.period ?? null,
        price: t.price ?? null,
      })),
      seasonalPricings: product.seasonalPricings,
    },
    null,
    null,
    pricedAt,
  );

  // Added: the server's price. Priced again: the promotion the line recorded, applied as recorded.
  const subtotal = added
    ? added.subtotal
    : subtotalWithRecordedPromotion(result.subtotal, item.stored).subtotal;
  const tierLabel = buildTierLabel(item, result.discountPercent, duration);

  const displayPricingMode = isRateBasedProduct({
    basePeriodMinutes: product.basePeriodMinutes,
  })
    ? resolveRateDisplayPricingMode(durationMinutes, mode)
    : mode;
  const displayDuration =
    product.pricingKind === "fixed" ? 1 : calculateDuration(startDate, endDate, displayPricingMode);

  // Derive an effective unit price for display (total / duration / quantity)
  const effectiveUnitPrice =
    displayDuration > 0 && item.quantity > 0
      ? subtotal / displayDuration / item.quantity
      : parseFloat(product.price);

  return {
    totalPrice: subtotal,
    effectiveUnitPrice,
    displayPricingMode,
    tierLabel,
    discount: result.discountPercent ?? 0,
    originalSubtotal: result.originalSubtotal,
    // Ordinary duration rates are cheaper than repeated base periods; that gap
    // is not a promotion, so only explicit discounts count as savings.
    savings: getEffectiveDiscountPercent(result) > 0 ? result.savings : 0,
    discountPercent: result.discountPercent,
    duration,
    displayDuration,
    tax: TAX_OF_TODAY,
  };
}

/** What the edit form's summary shows of the totals the edit will write. */
export interface EditPreviewTotals {
  /** The lines plus the insurance, as the reservation stores its subtotal. */
  subtotal: number;
  /** The tax, or null with taxes off. */
  taxAmount: number | null;
  /** The total tax included: what the edit writes, and the form sends. */
  total: number;
  /** Prices given before tax: the subtotal and the tax are shown as lines of their own. */
  taxOnTop: boolean;
}

/**
 * The totals the edit will write (slice 10): the tax engine over the lines,
 * the insurance (exempt), the delivery fee and the discount, in the mode the
 * reservation recorded or else the store's, with the same function and the
 * same inputs as the server (`priceReservationEdit`). One call gives the
 * total and the figures the summary shows beside it.
 */
export function previewEditTotals(params: {
  items: ReadonlyArray<{
    totalPrice: number;
    effectiveUnitPrice: number;
    product: Product | null;
    /** The tax it is priced with (slice 11): a rate it keeps, or today's settings. */
    tax?: EditedLineTax;
  }>;
  insuranceAmount: number;
  discountAmount: number;
  deliveryFee: number;
  deposit: number;
  storeTax: TaxSettings | undefined;
  recordedTaxDisplayMode: TaxDisplayMode | null;
  /** The reservation's currency, as the server totals it. */
  currency?: string;
}): EditPreviewTotals {
  const totals = computeReservationTotals({
    lines: params.items.map((item) => ({
      subtotal: roundCurrency(item.totalPrice),
      unitPrice: roundCurrency(item.effectiveUnitPrice),
      taxSettings: editedLineTaxSettings(item.tax ?? TAX_OF_TODAY, item.product?.taxSettings),
    })),
    insuranceAmount: params.insuranceAmount,
    discountAmount: params.discountAmount,
    deliveryFee: params.deliveryFee,
    totalDeposit: params.deposit,
    taxSettings: taxSettingsForRepricing(params.storeTax, params.recordedTaxDisplayMode),
    currency: params.currency,
  });
  return {
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    total: totals.total,
    taxOnTop: totals.taxEnabled && totals.displayMode === "exclusive",
  };
}

/** The edit summary's figures, each one stored now or about to be written. */
export interface EditSummaryFigures {
  /** The total as stored, tax included. */
  before: number;
  /** The total the edit writes, tax included. */
  after: number;
  /** `after` less `before`, in the currency's minor unit. */
  difference: number;
  /** The discount stored, which `after` takes off; zero for none. */
  discount: number;
  /** With prices before tax: the subtotal and the tax of `after`; else null. */
  taxLines: { subtotal: number; tax: number } | null;
}

export const editSummaryFigures = (input: {
  storedTotal: number;
  preview: EditPreviewTotals;
  discountAmount: number;
  currency: string;
}): EditSummaryFigures => ({
  before: input.storedTotal,
  after: input.preview.total,
  difference: roundToMinorUnit(input.preview.total - input.storedTotal, input.currency),
  discount: input.discountAmount > 0 ? input.discountAmount : 0,
  taxLines: input.preview.taxOnTop
    ? { subtotal: input.preview.subtotal, tax: input.preview.taxAmount ?? 0 }
    : null,
});

interface UseEditReservationPricingParams {
  startDate: Date | undefined;
  endDate: Date | undefined;
  items: EditableItem[];
  fixedChargesTotal?: number;
  /** The window as stored: a line is priced again when the window is not this one. */
  storedWindow?: { start: Date; end: Date };
  /** The reservation's currency, in whose minor unit a typed price's total is rounded. */
  currency?: string;
  /** The server's instant when it read the reservation (`EditReservationFormProps.pricedAt`). */
  pricedAt: Date;
}

export function useEditReservationPricing({
  startDate,
  endDate,
  items,
  fixedChargesTotal = 0,
  storedWindow,
  currency,
  pricedAt,
}: UseEditReservationPricingParams) {
  const timezone = useStoreTimezone();
  const getDurationForMode = (mode: PricingMode) => {
    if (!startDate || !endDate) return 0;
    return calculateDuration(startDate, endDate, mode);
  };

  const getDurationUnit = (mode: PricingMode) =>
    mode === "hour" ? "h" : mode === "week" ? "sem" : "j";

  const newDuration = startDate && endDate ? calculateDuration(startDate, endDate, "day") : 0;
  const storedStart = storedWindow?.start.getTime();
  const storedEnd = storedWindow?.end.getTime();

  const calculations = useMemo<ReservationCalculations>(() => {
    if (!startDate || !endDate) {
      return {
        items: items.map((item) => ({
          ...item,
          totalPrice: 0,
          duration: 0,
          displayDuration: 0,
          effectiveUnitPrice: item.unitPrice,
          displayPricingMode: item.pricingMode,
          tierLabel: null,
          discount: 0,
          originalSubtotal: 0,
          savings: 0,
          discountPercent: null,
          tax: TAX_OF_TODAY,
        })),
        subtotal: 0,
        deposit: 0,
        totalSavings: 0,
      };
    }

    const windowChanged =
      storedStart === undefined ||
      startDate.getTime() !== storedStart ||
      endDate.getTime() !== storedEnd;
    const calculatedItems: CalculatedEditableItem[] = [];
    let subtotal = 0;
    let deposit = 0;
    let totalSavings = 0;

    for (const item of items) {
      const priceResult = calculateEditableItemPrice(
        item,
        startDate,
        endDate,
        timezone,
        windowChanged,
        currency,
        pricedAt,
      );

      calculatedItems.push({
        ...item,
        totalPrice: priceResult.totalPrice,
        duration: priceResult.duration,
        displayDuration: priceResult.displayDuration,
        effectiveUnitPrice: priceResult.effectiveUnitPrice,
        displayPricingMode: priceResult.displayPricingMode,
        tierLabel: priceResult.tierLabel,
        discount: priceResult.discount,
        originalSubtotal: priceResult.originalSubtotal,
        savings: priceResult.savings,
        discountPercent: priceResult.discountPercent,
        tax: priceResult.tax,
      });

      subtotal = roundCurrency(subtotal + priceResult.totalPrice);
      deposit = roundCurrency(deposit + item.depositPerUnit * item.quantity);
      totalSavings = roundCurrency(totalSavings + priceResult.savings);
    }

    const normalizedFixedCharges = Number.isFinite(fixedChargesTotal) ? fixedChargesTotal : 0;
    const subtotalWithFixedCharges = roundCurrency(subtotal + normalizedFixedCharges);

    return {
      items: calculatedItems,
      subtotal: subtotalWithFixedCharges,
      deposit,
      totalSavings,
    };
  }, [
    items,
    startDate,
    endDate,
    fixedChargesTotal,
    timezone,
    storedStart,
    storedEnd,
    currency,
    pricedAt,
  ]);

  return {
    getDurationForMode,
    getDurationUnit,
    newDuration,
    calculations,
  };
}

import type { PricingKind, StockKind } from "@louez/types";

/**
 * The stock choice a rental company makes when creating a product. The four
 * options are exactly the valid (stock kind, unit tracking) pairs, because only
 * returnable stock can be tracked unit by unit — so the form never has to show
 * an option greyed out for "turn off unit tracking first".
 */
export const STOCK_OPTIONS = ["quantity", "units", "consumable", "untracked"] as const;

export type StockOption = (typeof STOCK_OPTIONS)[number];

interface StockFields {
  stockKind: StockKind;
  trackUnits: boolean;
}

export const getStockOption = ({
  stockKind,
  trackUnits,
}: {
  stockKind?: StockKind;
  trackUnits?: boolean;
}): StockOption => {
  if (stockKind === "consumable" || stockKind === "untracked") return stockKind;
  return trackUnits ? "units" : "quantity";
};

export const getStockOptionFields = (option: StockOption): StockFields => {
  if (option === "units") return { stockKind: "returnable", trackUnits: true };
  if (option === "quantity") return { stockKind: "returnable", trackUnits: false };
  return { stockKind: option, trackUnits: false };
};

export interface StockOptionImpact {
  /** Confirmed or ongoing reservations forbid changing the stock kind. */
  blockedByReservations: boolean;
  /** A consumable is always sold at a flat rate. */
  switchesToFixedPrice: boolean;
  /** Leaving unit tracking deletes the registered units. */
  removesUnits: boolean;
}

/** What picking an option changes elsewhere, so its card can say so before the click. */
export const getStockOptionImpact = (
  option: StockOption,
  {
    current,
    pricingKind,
    stockKindLocked,
    unitCount,
  }: {
    current: StockOption;
    pricingKind?: PricingKind;
    stockKindLocked: boolean;
    unitCount: number;
  },
): StockOptionImpact => ({
  blockedByReservations:
    stockKindLocked &&
    getStockOptionFields(option).stockKind !== getStockOptionFields(current).stockKind,
  switchesToFixedPrice: option === "consumable" && pricingKind !== "fixed",
  removesUnits: current === "units" && option !== "units" && unitCount > 0,
});

export interface PricingKindImpact {
  /** Leaving the flat rate would turn a consumable back into returnable stock,
   *  which its reservations forbid. */
  blockedByReservations: boolean;
  /** A consumable cannot be priced by duration, so its stock becomes a simple quantity. */
  switchesStockToQuantity: boolean;
}

export const getPricingKindImpact = (
  kind: PricingKind,
  { stockKind, stockKindLocked }: { stockKind?: StockKind; stockKindLocked: boolean },
): PricingKindImpact => {
  const leavesConsumable = kind === "duration" && stockKind === "consumable";
  return {
    blockedByReservations: leavesConsumable && stockKindLocked,
    switchesStockToQuantity: leavesConsumable && !stockKindLocked,
  };
};

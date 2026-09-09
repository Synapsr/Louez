import type { BookingAttributeAxis, CombinationAvailability } from "@louez/types";
import {
  combineStockQuantityLimits,
  getSelectionCapacity,
  type StockQuantityLimit,
} from "@louez/utils";

export interface BookingCapacityInput {
  /** Stock bookable today, before any period is chosen (`null` = unlimited). */
  baseMaxQuantity: StockQuantityLimit;
  /**
   * Stock for the chosen period, once the availability call answered;
   * `undefined` while no period is chosen or the call has not answered.
   */
  periodMaxQuantity: StockQuantityLimit | undefined;
  axes: BookingAttributeAxis[];
  /** Combinations to allocate against: the period ones when known, else today's. */
  combinations: CombinationAvailability[];
  selectedAttributes: Record<string, string>;
}

export interface BookingCapacity {
  /** Highest quantity the customer may pick (`null` = unlimited). */
  maxQuantity: StockQuantityLimit;
  /** `split` when a partial selection may spread over several combinations. */
  allocationMode: "single" | "split";
  /** True when the selection has no stock at all. */
  isSelectionUnavailable: boolean;
}

/**
 * How many units the customer may book for the current selection. Without
 * attribute axes it is the stock (period stock once known, today's before).
 * With axes, the stock is further bounded by the units matching the
 * selection: a full selection takes the best single combination, a partial
 * one adds up every matching combination (the cart then splits the lines).
 */
export const resolveBookingCapacity = ({
  baseMaxQuantity,
  periodMaxQuantity,
  axes,
  combinations,
  selectedAttributes,
}: BookingCapacityInput): BookingCapacity => {
  const stockBound = periodMaxQuantity === undefined ? baseMaxQuantity : periodMaxQuantity;

  if (axes.length === 0) {
    return {
      maxQuantity: stockBound,
      allocationMode: "single",
      isSelectionUnavailable: stockBound === 0,
    };
  }

  const selection = getSelectionCapacity(axes, combinations, selectedAttributes);
  const maxQuantity = combineStockQuantityLimits(stockBound, selection.capacity);

  return {
    maxQuantity,
    allocationMode: selection.allocationMode,
    isSelectionUnavailable: maxQuantity === 0,
  };
};

/** Keeps a quantity inside `[1, max]`; an unlimited max only enforces the floor. */
export const clampBookingQuantity = (quantity: number, max: StockQuantityLimit): number => {
  const floored = Math.max(1, Math.floor(quantity));
  return max === null ? floored : Math.max(1, Math.min(floored, max));
};

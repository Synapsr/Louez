import type { StockKind } from "@louez/types";

/** `null` means Louez does not enforce a stock quantity limit. */
export type StockQuantityLimit = number | null;

export function getAvailableStockQuantity(params: {
  stockKind: StockKind;
  totalQuantity: number;
  reservedQuantity?: number;
}): StockQuantityLimit {
  if (params.stockKind === "untracked") {
    return null;
  }

  return Math.max(0, params.totalQuantity - (params.reservedQuantity ?? 0));
}

export function combineStockQuantityLimits(...limits: StockQuantityLimit[]): StockQuantityLimit {
  const finiteLimits = limits.filter((limit): limit is number => limit !== null);

  return finiteLimits.length > 0
    ? Math.min(...finiteLimits.map((limit) => Math.max(0, limit)))
    : null;
}

export function divideStockQuantityLimit(
  limit: StockQuantityLimit,
  quantityPerParent: number,
): StockQuantityLimit {
  return limit === null ? null : Math.floor(Math.max(0, limit) / Math.max(1, quantityPerParent));
}

export function isWithinStockQuantityLimit(quantity: number, limit: StockQuantityLimit): boolean {
  return limit === null || quantity <= limit;
}

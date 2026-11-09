import type { UnitAttributes } from "@louez/types";

export interface AllocatableCombination {
  combinationKey: string;
  totalQuantity: number;
  selectedAttributes: UnitAttributes;
}

/**
 * Spreads a quantity over combinations in the given order, taking from each
 * what it has left. Returns the quantity taken per combination key, or null
 * when the combinations cannot cover the whole quantity together.
 */
export const allocateAcrossCombinations = (
  candidates: readonly AllocatableCombination[],
  reservedByCombinationKey: (combinationKey: string) => number,
  quantity: number,
): Map<string, number> | null => {
  const taken = new Map<string, number>();
  let remaining = quantity;

  for (const candidate of candidates) {
    if (remaining === 0) break;
    const free = Math.max(
      0,
      candidate.totalQuantity - reservedByCombinationKey(candidate.combinationKey),
    );
    const take = Math.min(free, remaining);
    if (take === 0) continue;
    taken.set(candidate.combinationKey, take);
    remaining -= take;
  }

  return remaining === 0 ? taken : null;
};

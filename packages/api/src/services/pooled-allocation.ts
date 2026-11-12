import type { UnitAttributes } from "@louez/types";

export interface AllocatableCombination {
  combinationKey: string;
  totalQuantity: number;
  selectedAttributes: UnitAttributes;
}

/**
 * Spreads a quantity over combinations in the given order, taking from each
 * what it has left. Returns the quantity taken per combination key, and what
 * the combinations could not cover together.
 */
export const spreadAcrossCombinations = (
  candidates: readonly AllocatableCombination[],
  reservedByCombinationKey: (combinationKey: string) => number,
  quantity: number,
): { taken: Map<string, number>; missing: number } => {
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

  return { taken, missing: remaining };
};

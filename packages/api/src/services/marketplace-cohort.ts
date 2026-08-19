export const DEFAULT_REEENT_LAUNCH_COHORT_SIZE = 1_000;

export interface MarketplaceCohortStatus {
  taken: number;
  total: number;
  remaining: number;
}

export function normalizeMarketplaceCohortSize(total: number): number {
  return Math.max(0, Math.floor(total));
}

export function marketplaceCohortStatus(
  taken: number,
  total: number = DEFAULT_REEENT_LAUNCH_COHORT_SIZE,
): MarketplaceCohortStatus {
  const normalizedTotal = normalizeMarketplaceCohortSize(total);
  const normalizedTaken = Math.min(normalizedTotal, Math.max(0, Math.floor(taken)));

  return {
    taken: normalizedTaken,
    total: normalizedTotal,
    remaining: normalizedTotal - normalizedTaken,
  };
}

export function nextMarketplaceCohortRank(
  taken: number,
  total: number = DEFAULT_REEENT_LAUNCH_COHORT_SIZE,
): number | null {
  const status = marketplaceCohortStatus(taken, total);
  return status.remaining > 0 ? status.taken + 1 : null;
}

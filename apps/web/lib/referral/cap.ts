/**
 * Whether a Referrer may earn one more reward this calendar month. A cap of 0 (or less)
 * means unlimited — the launch default. Otherwise the Referrer is capped at `monthlyCap`
 * rewards per month. Pure.
 */
export function isWithinMonthlyCap(params: {
  /** Rewards already granted to this Referrer in the current calendar month. */
  rewardedThisMonth: number;
  /** Per-referrer monthly cap. 0 or less = unlimited. */
  monthlyCap: number;
}): boolean {
  if (params.monthlyCap <= 0) return true;
  return params.rewardedThisMonth < params.monthlyCap;
}

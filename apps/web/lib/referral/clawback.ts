export interface FreeReservationClawbackInput {
  /** Free reservations originally granted by the reward being clawed back. */
  rewardFreeReservations: number;
  /** The Referrer's current total granted free reservations (subscriptions.freeReservationsGranted). */
  grantedTotal: number;
  /** Free reservations already consumed (count of non-voided source='free' ledger rows). */
  usedTotal: number;
}

export interface FreeReservationClawbackResult {
  /** How many free reservations to revoke. */
  revoke: number;
  /** The Referrer's resulting granted total after the clawback. */
  newGrantedTotal: number;
}

/**
 * Clawback of a free-reservation Referrer Reward. Revokes the reward's free reservations
 * but never below what the Referrer has already consumed (you cannot un-waive a past
 * rental). Pure.
 */
export function computeFreeReservationClawback(
  input: FreeReservationClawbackInput,
): FreeReservationClawbackResult {
  const reward = Math.max(0, Math.trunc(input.rewardFreeReservations));
  const granted = Math.max(0, Math.trunc(input.grantedTotal));
  const used = Math.max(0, Math.trunc(input.usedTotal));

  const revocable = Math.max(0, granted - used);
  const revoke = Math.min(reward, revocable);

  return { revoke, newGrantedTotal: granted - revoke };
}

/**
 * Whether a refunded/disputed qualifying payment is still inside the clawback window
 * (the reward is only reversed if the reversal happens within N days of the grant). Pure.
 */
export function isWithinClawbackWindow(params: {
  grantedAt: Date;
  eventAt: Date;
  clawbackWindowDays: number;
}): boolean {
  const elapsedMs = params.eventAt.getTime() - params.grantedAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  const windowMs = Math.max(0, params.clawbackWindowDays) * 24 * 60 * 60 * 1000;
  return elapsedMs <= windowMs;
}

/** How a Reservation payment reached the Store. Only an online (Stripe) payment can qualify a referral. */
export type QualifyingPaymentChannel = 'online' | 'manual';

export interface QualificationInput {
  /** The amount actually paid online, in cents (e.g. Stripe `amount_total`). */
  amountCents: number;
  /** The payment channel. A manual reservation never qualifies — it is forgeable. */
  channel: QualifyingPaymentChannel;
  /** Configured minimum qualifying amount, in cents. */
  minQualifyingAmountCents: number;
}

/**
 * Whether a Referred Store's payment is a Qualifying Event for the Referrer Reward.
 * A referral qualifies only on a real online (Stripe) Reservation payment at or above
 * the configured minimum. Pure.
 */
export function qualifiesForReferralReward(input: QualificationInput): boolean {
  if (input.channel !== 'online') return false;
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) return false;
  const min = Math.max(0, input.minQualifyingAmountCents);
  return input.amountCents >= min;
}

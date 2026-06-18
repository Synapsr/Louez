/** The Referrer's billing mode at reward time — decides the reward currency. */
export type ReferrerBillingMode = 'pay_as_you_go' | 'subscription';

/** Free reservations for a pay-as-you-go Referrer; euro invoice credit for a subscribed one. */
export type ReferralRewardKind = 'free_reservations' | 'invoice_credit';

export interface ReferrerRewardInput {
  billingMode: ReferrerBillingMode;
  /** Reward size in free reservations (config.referrerRewardFreeReservations). */
  freeReservations: number;
  /** Monetary value of one free reservation for this Referrer, in cents (their entry-tier PAYG price). */
  unitValueCents: number;
}

export interface ReferrerReward {
  kind: ReferralRewardKind;
  /** Free reservations to grant (>0 only when kind === 'free_reservations'). */
  freeReservations: number;
  /** Euro invoice credit in cents to grant (>0 only when kind === 'invoice_credit'). */
  creditCents: number;
  /** Monetary value shown to the Referrer as "N réservations offertes ≈ Y €". Always set. */
  displayValueCents: number;
}

/**
 * Plan-aware Referrer Reward. A pay-as-you-go Referrer earns N free reservations; a
 * subscribed Referrer — who pays no per-reservation commission, so free reservations
 * would be worth €0 — earns the equivalent euro invoice credit instead. Both carry the
 * same displayed value. Pure.
 */
export function computeReferrerReward(input: ReferrerRewardInput): ReferrerReward {
  const freeReservations = Math.max(0, Math.trunc(input.freeReservations));
  const unitValueCents = Math.max(0, Math.trunc(input.unitValueCents));
  const displayValueCents = freeReservations * unitValueCents;

  if (input.billingMode === 'subscription') {
    return {
      kind: 'invoice_credit',
      freeReservations: 0,
      creditCents: displayValueCents,
      displayValueCents,
    };
  }

  return {
    kind: 'free_reservations',
    freeReservations,
    creditCents: 0,
    displayValueCents,
  };
}

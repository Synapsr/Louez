/**
 * Reservation Mode: intent vs. effective behaviour.
 *
 * A Store's `settings.reservationMode` records *intent* (Payment by default at
 * onboarding). What the storefront actually does is the *Effective Reservation
 * Mode*, derived from that intent plus Stripe readiness: a Store in Payment Mode
 * whose Stripe is not chargeable behaves as Request Mode, and upgrades to online
 * checkout automatically once Stripe becomes chargeable (the `account.updated`
 * webhook flips `stripeChargesEnabled`).
 *
 * This keeps the storefront working before Stripe setup and makes Payment a safe
 * default. See docs/adr/0004-effective-reservation-mode-degrades-without-stripe.md.
 *
 * Storefront customer-facing behaviour and the dashboard degradation alert MUST
 * use the effective mode. Settings screens that edit the Store's intent keep
 * using `settings.reservationMode` directly.
 */

export type ReservationMode = 'payment' | 'request';

interface ReservationModeStore {
  settings?: { reservationMode?: ReservationMode | null } | null;
  stripeAccountId?: string | null;
  stripeChargesEnabled?: boolean | null;
}

/** True when the Store can actually take an online payment through Stripe. */
export function isStripeChargeable(store: ReservationModeStore): boolean {
  return Boolean(store.stripeAccountId && store.stripeChargesEnabled);
}

/** The Store's chosen intent (defaults to Payment, the onboarding default). */
export function getIntendedReservationMode(
  store: ReservationModeStore,
): ReservationMode {
  return store.settings?.reservationMode === 'request' ? 'request' : 'payment';
}

/**
 * What the storefront should actually do right now. Payment degrades to Request
 * until Stripe is chargeable.
 */
export function getEffectiveReservationMode(
  store: ReservationModeStore,
): ReservationMode {
  return getIntendedReservationMode(store) === 'payment' &&
    isStripeChargeable(store)
    ? 'payment'
    : 'request';
}

/**
 * True when the Store wants Payment Mode but Stripe is not chargeable yet, so it
 * is silently operating as Request Mode. This is the "losing money" state the
 * dashboard surfaces as a prominent alert.
 */
export function isPaymentModeDegraded(store: ReservationModeStore): boolean {
  return getIntendedReservationMode(store) === 'payment' &&
    !isStripeChargeable(store);
}

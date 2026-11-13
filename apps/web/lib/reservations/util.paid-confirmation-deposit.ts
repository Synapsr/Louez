/**
 * Whether the paid confirmation leaves a reservation's deposit as stored: its
 * `depositStatus`, `stripeCustomerId` and `stripePaymentMethodId`. It does when funds
 * are held or were taken on the reservation, by its `depositStatus` or by its hold
 * ledger, since a hold can be settled on a reservation still `pending`, and a
 * `depositStatus` the confirmation wrote over a hold says `card_saved` while its row
 * still holds the funds. Otherwise it writes what the session gave: `failed` and
 * `released` hold nothing, and the customer's new card lets the store take a hold
 * again (docs/domain/reservation-changes.md, slice 6a-1).
 */
export function paidConfirmationKeepsDeposit(found: {
  /** The reservation's, as read under its row lock. */
  readonly depositStatus: string | null;
  /** One of its `deposit_hold` rows is `authorized` or `completed`, read under the same lock. */
  readonly ledgerHoldsFunds: boolean;
}): boolean {
  return (
    found.depositStatus === "authorized" ||
    found.depositStatus === "captured" ||
    found.ledgerHoldsFunds
  );
}

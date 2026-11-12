/**
 * What a `deposit_hold` payment row says, for whoever lists payments. Its status
 * follows the payment provider (apps/web lib/reservations/deposit-hold-writes.ts), which is
 * not what a reader should print as it is: a row asked for and never confirmed, one
 * the provider refused, and a second authorization on its way out are no hold of the
 * reservation, and none of them is money.
 */
export type DepositHoldRowKind =
  /** The store asked for the authorization; the provider has not confirmed it. */
  | "unconfirmed"
  /** The provider refused: nothing is held. */
  | "failed"
  /** The amount is held on the card: the reservation's hold. */
  | "held"
  /**
   * The provider holds it, and it is not the reservation's hold: the reservation has
   * another, and this one is being released.
   */
  | "release_pending"
  /** Captured: its `deposit_capture` row says how much was taken. */
  | "captured"
  /** The provider cancelled it: nothing is held. */
  | "cancelled";

export interface DepositHoldRowLike {
  type: string;
  status: string;
  /** Set while the provider still has to release an authorization Louez decided against. */
  releaseOwedAt?: Date | string | null;
}

/** The kind of a hold row; null for any other payment row. */
export const depositHoldRowKind = (row: DepositHoldRowLike): DepositHoldRowKind | null => {
  if (row.type !== "deposit_hold") return null;
  if (row.status === "pending") return "unconfirmed";
  if (row.status === "failed") return "failed";
  if (row.status === "authorized") return row.releaseOwedAt ? "release_pending" : "held";
  if (row.status === "completed") return "captured";
  return "cancelled";
};

/**
 * The status a list of payments states for a row: a hold's kind, any other row's own
 * status. A hold that is the reservation's reads `authorized`, as it always did.
 */
export const paymentRowStatus = (row: DepositHoldRowLike): string => {
  const kind = depositHoldRowKind(row);
  if (kind === null) return row.status;
  if (kind === "held") return "authorized";
  if (kind === "captured") return "completed";
  return kind;
};

const HOLD_ROW_DESCRIPTIONS: Record<DepositHoldRowKind, string> = {
  unconfirmed:
    "authorization asked, not confirmed by Stripe: no hold is confirmed, and no other can be asked until Stripe settles this one",
  failed: "authorization refused: nothing is held",
  held: "authorized: the amount is held on the card, not charged",
  release_pending:
    "a second authorization, not the reservation's hold: it is being released, and may still show on the card",
  captured: "captured: the deposit_capture payment states the amount taken",
  cancelled: "cancelled: nothing is held",
};

/** A hold row's kind in plain English, for an agent that reads payments. */
export const describeDepositHoldRow = (kind: DepositHoldRowKind): string =>
  HOLD_ROW_DESCRIPTIONS[kind];

/**
 * Whether a hold row belongs in what a customer is shown, on their account or on the
 * contract: the hold their card carries for the reservation, its capture, or its
 * release. An attempt, a refusal, a second authorization on its way out and a
 * PaymentIntent that never became the reservation's hold are the store's business.
 */
export const isCustomerDepositHoldRow = (
  row: DepositHoldRowLike & { stripePaymentIntentId?: string | null },
  reservationHoldPaymentIntentId: string | null | undefined,
): boolean => {
  const kind = depositHoldRowKind(row);
  if (kind === "held" || kind === "captured") return true;
  return (
    kind === "cancelled" &&
    Boolean(row.stripePaymentIntentId) &&
    row.stripePaymentIntentId === reservationHoldPaymentIntentId
  );
};

/**
 * Which charge a Stripe refund row gives money back for.
 *
 * Refund rows written before `ensureRefundPaymentRecord` filled
 * `refundOfPaymentId` only share a reservation with their charge, and a
 * reservation can hold several Stripe charges (down payment then balance). The
 * backfill therefore links a refund only when a single charge can be meant, and
 * reports every other case instead of guessing.
 */

export interface RefundLinkPayment {
  id: string;
  type: string;
  status: string;
  stripeChargeId: string | null;
  stripeRefundId: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
}

export type RefundLinkResult =
  | { status: "linked"; originalId: string; matchedBy: "charge" | "reservation" }
  | { status: "ambiguous"; reason: "no_candidate" | "several_candidates"; candidateIds: string[] };

/** What a refund row of a given type can have refunded, when no charge id says so. */
const ORIGINAL_TYPES_BY_REFUND_TYPE: Record<string, readonly string[]> = {
  rental: ["rental"],
  // A hold is an authorisation: only a cashed deposit or a capture is a charge.
  deposit_return: ["deposit", "deposit_capture"],
};

/** A charge carries a payment intent or a checkout session; a refund row carries neither. */
const isStripeOriginal = (payment: RefundLinkPayment): boolean =>
  payment.stripePaymentIntentId !== null || payment.stripeCheckoutSessionId !== null;

/** Only money that was cashed can have been refunded. */
const wasCashed = (payment: RefundLinkPayment): boolean =>
  payment.status === "completed" || payment.status === "refunded";

export const pickRefundOriginal = (
  refund: RefundLinkPayment,
  reservationPayments: readonly RefundLinkPayment[],
): RefundLinkResult => {
  const originals = reservationPayments.filter(
    (payment) => payment.id !== refund.id && isStripeOriginal(payment) && wasCashed(payment),
  );

  const matchedBy = refund.stripeChargeId ? "charge" : "reservation";
  const candidates = refund.stripeChargeId
    ? originals.filter((payment) => payment.stripeChargeId === refund.stripeChargeId)
    : originals.filter((payment) =>
        (ORIGINAL_TYPES_BY_REFUND_TYPE[refund.type] ?? []).includes(payment.type),
      );

  const [only] = candidates;
  if (only && candidates.length === 1) return { status: "linked", originalId: only.id, matchedBy };

  return {
    status: "ambiguous",
    reason: candidates.length === 0 ? "no_candidate" : "several_candidates",
    candidateIds: candidates.map((payment) => payment.id),
  };
};

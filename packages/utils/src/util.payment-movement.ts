/**
 * How a `payments` row moves money. `packages/db/src/payment-receipts.ts`
 * applies the same rule in SQL: change one, change the other.
 */

export interface StripeRefundIds {
  stripeRefundId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
}

/**
 * A Stripe refund is its own positive row: it carries the refund id and none of
 * the ids a charge is created with. The refund id alone is not enough, since
 * older webhooks also stamped it on the refunded charge. Both charge ids must be
 * loaded and empty: a caller that did not select them never loses a receipt.
 */
export const isStripeRefundRow = (payment: StripeRefundIds): boolean =>
  Boolean(payment.stripeRefundId) &&
  payment.stripePaymentIntentId === null &&
  payment.stripeCheckoutSessionId === null;

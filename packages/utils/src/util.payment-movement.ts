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

/** A payment row as `getSettledPaymentAmount` reads it. */
export interface SettledPaymentRow extends StripeRefundIds {
  id?: string;
  type: string;
  status: string;
  amount: string | number;
  /** Set on the row that gives money back for another row. */
  refundOfPaymentId?: string | null;
  /** With `currency`, tells a Stripe payment, whose currency is its own. */
  method?: string;
  currency?: string | null;
}

/**
 * Whether a payment row is money in `currency`, the reservation's. Only a Stripe
 * payment states its own currency: any other row is in its reservation's, whatever
 * the column holds (older manual rows kept its EUR default). `sales-analytics.ts`
 * applies the same rule in SQL. A row loaded without its method or its currency
 * counts: a caller that did not select them never loses a receipt.
 */
export const isPaymentInCurrency = (
  payment: Pick<SettledPaymentRow, "method" | "currency">,
  currency: string,
): boolean =>
  payment.method !== "stripe" ||
  !payment.currency ||
  payment.currency.toUpperCase() === currency.toUpperCase();

const toAmount = (value: string | number): number => {
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
};

/**
 * Completed money of one type, refunds of that type subtracted. A refund is
 * a row pointing at the row it gives back (`refundOfPaymentId`), so its own
 * `type` is not what it refunds. A Stripe refund row counts for nothing: the
 * webhook already brought the charge it refunds down to its net amount.
 *
 * With `currency`, the reservation's, a payment in another currency counts for
 * nothing: it does not reduce what the reservation is owed. Neither does a refund
 * of such a payment, which gives back money that was never counted.
 */
export const getSettledPaymentAmount = (
  payments: readonly SettledPaymentRow[],
  type: string,
  currency?: string,
): number => {
  const byId = new Map(payments.flatMap((payment) => (payment.id ? [[payment.id, payment]] : [])));
  return payments.reduce((sum, payment) => {
    if (payment.status !== "completed") return sum;
    if (isStripeRefundRow(payment)) return sum;
    const amount = toAmount(payment.amount);
    if (payment.refundOfPaymentId) {
      const original = byId.get(payment.refundOfPaymentId);
      if (original?.type !== type) return sum;
      return currency && !isPaymentInCurrency(original, currency) ? sum : sum - amount;
    }
    if (currency && !isPaymentInCurrency(payment, currency)) return sum;
    return payment.type === type ? sum + amount : sum;
  }, 0);
};

import { type DepositHoldRowLike, withLatestFailedHoldOnly } from "@louez/utils";

/** A payment row as the reservation's payment history reads it. */
export interface PaymentHistoryRow extends DepositHoldRowLike {
  type: string;
  method: string;
  status: string;
  createdAt: Date | string;
  stripeCheckoutSessionId?: string | null;
  /** When Stripe said the row's Checkout Session can no longer be paid; null while unknown. */
  sessionSettledAt?: Date | string | null;
}

/**
 * A rental checkout that took nothing and never will: its row `cancelled`, its
 * session settled at Stripe. Each one the customer's page or a payment request
 * replaced leaves one; the activity timeline keeps it, the history does not.
 * One whose session is not known to be over may still be paid, and stays.
 */
export const isSettledCheckoutAttempt = (payment: PaymentHistoryRow): boolean =>
  payment.method === "stripe" &&
  payment.type === "rental" &&
  payment.status === "cancelled" &&
  Boolean(payment.stripeCheckoutSessionId) &&
  Boolean(payment.sessionSettledAt);

/**
 * The rows the payment history lists: money that moved, and the attempts that
 * matter to the store. Left out: a Stripe payment still pending (its checkout
 * is open), a checkout that took nothing and is over (`isSettledCheckoutAttempt`),
 * and all but the latest refused or closed deposit hold (each new try leaves one,
 * and none holds money). The dashboard's display only: totals, exports and the
 * API's payment list read every row.
 */
export const paymentHistoryRows = <T extends PaymentHistoryRow>(payments: readonly T[]): T[] =>
  withLatestFailedHoldOnly(payments).filter(
    (payment) =>
      !(payment.method === "stripe" && payment.status === "pending") &&
      !isSettledCheckoutAttempt(payment),
  );

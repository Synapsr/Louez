import { type DepositHoldRowLike, withLatestFailedHoldOnly } from "@louez/utils";

import {
  type PaymentLike,
  type PaymentRowReading,
  type RefundStatusByRow,
  readPaymentRow,
} from "@/lib/reservations/util.payment-status";

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

/** A payment row as the card's online payment tile reads it. */
export interface OnlinePaymentRow extends PaymentLike {
  id: string;
  amount: string;
  method: string;
  createdAt: Date | string;
  paidAt: Date | string | null;
}

const movedAt = (payment: OnlinePaymentRow) =>
  new Date(payment.paidAt ?? payment.createdAt).getTime();

/**
 * What the card's online payment tile tells: the latest of the rental's money that moved
 * through Stripe, the payment received (`completed`) or a refund of it, read by
 * `readPaymentRow` (a refund in progress or failed says so). A deposit's refund, money taken
 * by hand and a checkout still open are not it. Null when there is none.
 */
export const onlineRentalTile = <T extends OnlinePaymentRow>(
  payments: readonly T[],
  refundStatuses?: RefundStatusByRow,
): { payment: T; reading: PaymentRowReading } | null => {
  let latest: { payment: T; reading: PaymentRowReading } | null = null;
  for (const payment of payments) {
    if (payment.method !== "stripe" || payment.type !== "rental") continue;
    const reading = readPaymentRow(payment, refundStatuses);
    if (reading.kind === "hold") continue;
    if (reading.kind === "receipt" && payment.status !== "completed") continue;
    if (!latest || movedAt(payment) > movedAt(latest.payment)) latest = { payment, reading };
  }
  return latest;
};

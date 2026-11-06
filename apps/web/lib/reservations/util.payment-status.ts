/**
 * One reading of a reservation's payments, shared by the account list and
 * the reservation page. "Paid" means the rental itself is settled: a
 * completed `rental` payment. Deposits, holds and refunds never count.
 */

import { isStripeRefundRow } from "@louez/utils";

export interface PaymentLike {
  id?: string;
  type: string;
  status: string;
  amount: string | number;
  /** Set on the row that gives money back for another row. */
  refundOfPaymentId?: string | null;
  /** Stripe ids: together they tell a Stripe refund row from the charge it refunds. */
  stripeRefundId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
}

export type ReservationPaymentStatus = "paid" | "processing" | "unpaid";

const toAmount = (value: string | number): number => {
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
};

// One in-memory definition of a Stripe refund row, shared with the cash ledger.
export { isStripeRefundRow };

/** A row that gives money back: a refund of another row, or a deposit return. */
export const isRefundRow = (payment: PaymentLike): boolean =>
  Boolean(payment.refundOfPaymentId) ||
  isStripeRefundRow(payment) ||
  payment.type === "deposit_return";

export const isRentalPaid = (payments: readonly PaymentLike[]): boolean =>
  payments.some(
    (payment) =>
      payment.type === "rental" && payment.status === "completed" && !isRefundRow(payment),
  );

/** A rental payment still `pending` (3DS, webhook lag). */
export const hasRentalPaymentInProgress = (payments: readonly PaymentLike[]): boolean =>
  payments.some((payment) => payment.type === "rental" && payment.status === "pending");

export const getReservationPaymentStatus = (
  payments: readonly PaymentLike[],
): ReservationPaymentStatus => {
  if (isRentalPaid(payments)) return "paid";
  if (hasRentalPaymentInProgress(payments)) return "processing";
  return "unpaid";
};

/**
 * Completed money of one type, refunds of that type subtracted. A refund is
 * a row pointing at the row it gives back (`refundOfPaymentId`), so its own
 * `type` is not what it refunds. A Stripe refund row counts for nothing: the
 * webhook already brought the charge it refunds down to its net amount.
 */
export const getSettledPaymentAmount = (payments: readonly PaymentLike[], type: string): number => {
  const byId = new Map(payments.flatMap((payment) => (payment.id ? [[payment.id, payment]] : [])));
  return payments.reduce((sum, payment) => {
    if (payment.status !== "completed") return sum;
    if (isStripeRefundRow(payment)) return sum;
    const amount = toAmount(payment.amount);
    if (payment.refundOfPaymentId) {
      const original = byId.get(payment.refundOfPaymentId);
      return original?.type === type ? sum - amount : sum;
    }
    return payment.type === type ? sum + amount : sum;
  }, 0);
};

/** What the customer paid toward the rental itself: deposits never count. */
export const getRentalPaid = (payments: readonly PaymentLike[]): number =>
  getSettledPaymentAmount(payments, "rental");

/** Damage fees charged on top of the rental, refunds subtracted. */
export const getDamageFees = (payments: readonly PaymentLike[]): number =>
  getSettledPaymentAmount(payments, "damage");

/**
 * The payment rows worth listing to the customer: a hold that was captured
 * is dropped, since the capture row carries the amount actually taken and
 * the hold row would show the full deposit as "taken".
 */
export const getCustomerPaymentRows = <T extends PaymentLike>(payments: readonly T[]): T[] => {
  const captured = payments.some(
    (payment) => payment.type === "deposit_capture" && payment.status === "completed",
  );
  return payments.filter(
    (payment) => !(captured && payment.type === "deposit_hold" && payment.status === "completed"),
  );
};

/**
 * One reading of a reservation's payments, shared by the account list and
 * the reservation page. "Paid" means the rental itself is settled: a
 * completed `rental` payment. Deposits, holds and refunds never count.
 */

import {
  getSettledPaymentAmount,
  isCustomerDepositHoldRow,
  isPaymentInCurrency,
  isStripeRefundRow,
} from "@louez/utils";

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
  /** With `currency`, tells a Stripe payment, whose currency is its own. */
  method?: string;
  currency?: string | null;
  /** On a hold Louez decided against, until the provider released it. */
  releaseOwedAt?: Date | string | null;
}

export type ReservationPaymentStatus = "paid" | "processing" | "unpaid";

// One in-memory definition of a Stripe refund row, shared with the cash ledger.
export { isStripeRefundRow };

/** A row that gives money back: a refund of another row, or a deposit return. */
export const isRefundRow = (payment: PaymentLike): boolean =>
  Boolean(payment.refundOfPaymentId) ||
  isStripeRefundRow(payment) ||
  payment.type === "deposit_return";

/** With `currency`, the reservation's, a payment in another currency pays nothing. */
export const isRentalPaid = (payments: readonly PaymentLike[], currency?: string): boolean =>
  payments.some(
    (payment) =>
      payment.type === "rental" &&
      payment.status === "completed" &&
      !isRefundRow(payment) &&
      (!currency || isPaymentInCurrency(payment, currency)),
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
 * What the customer paid toward the rental itself: deposits never count. With
 * `currency`, the reservation's, neither does a payment in another currency.
 */
export const getRentalPaid = (payments: readonly PaymentLike[], currency?: string): number =>
  getSettledPaymentAmount(payments, "rental", currency);

/** Damage fees charged on top of the rental, refunds subtracted. */
export const getDamageFees = (payments: readonly PaymentLike[]): number =>
  getSettledPaymentAmount(payments, "damage");

/**
 * The payment rows worth listing to the customer. Of the deposit holds, only the
 * one their card carries for the reservation, `depositPaymentIntentId`, with its
 * release: an authorization the store asked for and Stripe never confirmed, a
 * refused one and a second one on its way out are not theirs to read
 * (`isCustomerDepositHoldRow`). A hold that was captured is dropped, since the
 * capture row carries the amount actually taken and the hold row would show the
 * full deposit as "taken".
 */
export const getCustomerPaymentRows = <T extends PaymentLike>(
  payments: readonly T[],
  depositPaymentIntentId: string | null | undefined,
): T[] => {
  const captured = payments.some(
    (payment) => payment.type === "deposit_capture" && payment.status === "completed",
  );
  return payments.filter((payment) => {
    if (payment.type !== "deposit_hold") return true;
    if (!isCustomerDepositHoldRow(payment, depositPaymentIntentId)) return false;
    return !(captured && payment.status === "completed");
  });
};

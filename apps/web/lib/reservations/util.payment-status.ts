/**
 * One reading of a reservation's payments, shared by the account list and
 * the reservation page. "Paid" means the rental itself is settled: a
 * completed `rental` payment. Deposits, holds and refunds never count.
 */

export interface PaymentLike {
  type: string;
  status: string;
  amount: string | number;
}

export type ReservationPaymentStatus = "paid" | "processing" | "unpaid";

const toAmount = (value: string | number): number => {
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
};

export const isRentalPaid = (payments: readonly PaymentLike[]): boolean =>
  payments.some((payment) => payment.type === "rental" && payment.status === "completed");

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

/** Sum of every completed payment, refunds (`deposit_return`) subtracted. */
export const getTotalPaid = (payments: readonly PaymentLike[]): number =>
  payments.reduce((sum, payment) => {
    if (payment.status !== "completed") return sum;
    const amount = toAmount(payment.amount);
    return payment.type === "deposit_return" ? sum - amount : sum + amount;
  }, 0);

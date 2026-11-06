import {
  getSettledPaymentAmount,
  isStripeRefundRow,
} from "@/lib/reservations/util.payment-status";

export type ManualPaymentMethod = "cash" | "card" | "transfer" | "check" | "other";

export const isManualPaymentMethod = (method: string): method is ManualPaymentMethod =>
  method === "cash" ||
  method === "card" ||
  method === "transfer" ||
  method === "check" ||
  method === "other";

export interface PaymentRefundState {
  id: string;
  amount: string;
  type: string;
  method: string;
  status: string;
  refundOfPaymentId: string | null;
  stripeRefundId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
}

const REFUNDABLE_PAYMENT_TYPES = new Set([
  "rental",
  "damage",
  "adjustment",
  "deposit_capture",
]);

/**
 * What is left to give back on a payment. A Stripe refund linked to its charge
 * is left out: the webhook already took it off the charge's amount.
 */
export const getRemainingRefundableAmount = (
  payment: PaymentRefundState,
  payments: PaymentRefundState[],
) => {
  const alreadyRefunded = payments
    .filter(
      (candidate) =>
        candidate.status === "completed" &&
        candidate.refundOfPaymentId === payment.id &&
        !isStripeRefundRow(candidate),
    )
    .reduce((total, candidate) => total + Number(candidate.amount), 0);

  return Math.max(0, Math.round((Number(payment.amount) - alreadyRefunded) * 100) / 100);
};

export const getNetCompletedPaymentAmount = (
  payments: PaymentRefundState[],
  paymentType: string,
) => getSettledPaymentAmount(payments, paymentType);

export const isManualPaymentRefundEligible = (
  payment: PaymentRefundState,
  payments: PaymentRefundState[],
) =>
  isManualPaymentMethod(payment.method) &&
  payment.status === "completed" &&
  payment.refundOfPaymentId === null &&
  REFUNDABLE_PAYMENT_TYPES.has(payment.type) &&
  Number(payment.amount) > 0 &&
  getRemainingRefundableAmount(payment, payments) > 0;

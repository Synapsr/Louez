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
}

const REFUNDABLE_PAYMENT_TYPES = new Set([
  "rental",
  "damage",
  "adjustment",
  "deposit_capture",
]);

export const getRemainingRefundableAmount = (
  payment: PaymentRefundState,
  payments: PaymentRefundState[],
) => {
  const alreadyRefunded = payments
    .filter(
      (candidate) =>
        candidate.status === "completed" && candidate.refundOfPaymentId === payment.id,
    )
    .reduce((total, candidate) => total + Number(candidate.amount), 0);

  return Math.max(0, Math.round((Number(payment.amount) - alreadyRefunded) * 100) / 100);
};

export const getNetCompletedPaymentAmount = (
  payments: PaymentRefundState[],
  paymentType: string,
) => {
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));

  return payments.reduce((total, payment) => {
    if (payment.status !== "completed") return total;
    if (payment.refundOfPaymentId) {
      const originalPayment = paymentsById.get(payment.refundOfPaymentId);
      return originalPayment?.type === paymentType ? total - Number(payment.amount) : total;
    }
    return payment.type === paymentType ? total + Number(payment.amount) : total;
  }, 0);
};

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

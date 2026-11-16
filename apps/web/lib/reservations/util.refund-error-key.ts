import { isApiError } from "@louez/api/platform/errors";

/**
 * The dashboard's text for a refund given by hand that was not recorded
 * (`refundManualPayment`): a payment not found, a reservation being changed at
 * that moment (its own text, as elsewhere in the dashboard), or else the amount.
 */
export function refundErrorKey(error: unknown): string {
  const code = isApiError(error) ? error.data.code : null;
  if (code === "PAYMENT_NOT_FOUND") return "errors.paymentNotFound";
  if (code === "RESERVATION_BUSY") return "errors.reservationStatusChanged";
  return "errors.invalidAmount";
}

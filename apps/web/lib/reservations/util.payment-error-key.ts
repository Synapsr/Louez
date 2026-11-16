import { isApiError } from "@louez/api/platform/errors";

/**
 * The dashboard's text for a refund given by hand or a deposit return that was
 * not recorded (`refundManualPayment`, `returnDeposit`, through the shared
 * writers): a record not found, a reservation being changed at that moment
 * (its own text, as elsewhere in the dashboard), a deposit return above the
 * balance, an amount with more decimals than its currency allows, a currency
 * Louez does not count, or else the amount.
 */
export function paymentErrorKey(error: unknown): string {
  if (!isApiError(error)) return "errors.invalidAmount";
  const { code } = error.data;
  const details = (error.data as { details?: { decimals?: unknown } }).details;
  switch (code) {
    case "PAYMENT_NOT_FOUND":
      return "errors.paymentNotFound";
    case "RESERVATION_NOT_FOUND":
      return "errors.reservationNotFound";
    case "RESERVATION_BUSY":
      return "errors.reservationStatusChanged";
    case "DEPOSIT_RETURN_EXCEEDS_BALANCE":
      return "errors.amountExceedsDeposit";
    case "REFUND_CURRENCY_NOT_SUPPORTED":
    case "PAYMENT_CURRENCY_NOT_SUPPORTED":
      return "errors.currencyNotSupportedForPayments";
    case "REFUND_AMOUNT_INVALID":
    case "DEPOSIT_RETURN_AMOUNT_INVALID":
      // With the currency's decimals: a well-formed amount, too precise.
      return typeof details?.decimals === "number"
        ? "errors.amountTooPrecise"
        : "errors.invalidAmount";
    default:
      return "errors.invalidAmount";
  }
}

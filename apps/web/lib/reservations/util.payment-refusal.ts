/**
 * The refusals the dashboard's payment actions answer with (`recordPayment`,
 * `returnDeposit`, `recordDamage`, `refundManualPayment`), each a key of the
 * root `errors` messages, in every locale.
 */
export const PAYMENT_REFUSAL_KEYS: ReadonlySet<string> = new Set([
  "errors.amountExceedsDeposit",
  "errors.amountExceedsDue",
  "errors.amountTooPrecise",
  "errors.currencyNotSupportedForPayments",
  "errors.invalidAmount",
  "errors.negativeAmountOnlyForAdjustment",
  "errors.paymentNotFound",
  "errors.reservationNotFound",
  "errors.reservationStatusChanged",
]);

/**
 * The `errors` message key of a payment action's refusal, for its toast:
 * the second of two deposit returns sent together reads that the amount
 * exceeds the deposit, not that something went wrong. Null for anything
 * else (a network error, a crash), which keeps the generic text.
 */
export function paymentRefusalKey(error: unknown): string | null {
  if (!(error instanceof Error) || !PAYMENT_REFUSAL_KEYS.has(error.message)) return null;
  return error.message.slice("errors.".length);
}

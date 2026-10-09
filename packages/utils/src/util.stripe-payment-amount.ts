// Card-payment minimums in the settlement currency. Stripe still validates
// conversions and account-specific limits: https://docs.stripe.com/currencies.
const STRIPE_MINIMUM_PAYMENT_AMOUNTS: Readonly<Record<string, number>> = {
  USD: 0.5,
  AED: 2,
  ARS: 0.5,
  AUD: 0.5,
  BRL: 0.5,
  CAD: 0.5,
  CHF: 0.5,
  COP: 0.5,
  CZK: 15,
  DKK: 2.5,
  EUR: 0.5,
  GBP: 0.3,
  HKD: 4,
  HUF: 175,
  IDR: 0.5,
  ILS: 0.5,
  INR: 0.5,
  JPY: 50,
  KRW: 50,
  MXN: 10,
  MYR: 2,
  NOK: 3,
  NZD: 0.5,
  PHP: 0.5,
  PLN: 2,
  RON: 2,
  RUB: 0.5,
  SEK: 3,
  SGD: 0.5,
  THB: 10,
  ZAR: 0.5,
};

export const getStripeMinimumPaymentAmount = (currency: string): number | null =>
  STRIPE_MINIMUM_PAYMENT_AMOUNTS[currency.toUpperCase()] ?? null;

export type StripePaymentAmountValidation =
  | { ok: true }
  | { ok: false; error: "errors.invalidAmount" }
  | {
      ok: false;
      error: "errors.paymentAmountTooSmall";
      params: { minimumAmount: number; currency: string };
    };

/** Validate server-priced amounts; never raise the customer's charge. */
export const validateStripePaymentAmount = (
  amount: number,
  currency: string,
): StripePaymentAmountValidation => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "errors.invalidAmount" };
  }
  const minimumAmount = getStripeMinimumPaymentAmount(currency);
  if (minimumAmount !== null && Math.round(amount * 100) < Math.round(minimumAmount * 100)) {
    return {
      ok: false,
      error: "errors.paymentAmountTooSmall",
      params: { minimumAmount, currency: currency.toUpperCase() },
    };
  }
  return { ok: true };
};

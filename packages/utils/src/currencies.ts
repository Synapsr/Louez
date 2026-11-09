/**
 * The currencies a store may use: those the app formats and Stripe charges
 * in, as the app uses them. A store's prices, deposits and payments are all
 * in its one currency.
 */
export const SUPPORTED_CURRENCY_CODES = [
  // Europe
  "EUR",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  // North America
  "USD",
  "CAD",
  "MXN",
  // South America
  "BRL",
  "ARS",
  "CLP",
  "COP",
  // Asia Pacific
  "AUD",
  "NZD",
  "JPY",
  "CNY",
  "INR",
  "SGD",
  "HKD",
  "KRW",
  "TWD",
  "THB",
  "MYR",
  "PHP",
  "VND",
  // Middle East & Africa
  "AED",
  "SAR",
  "ILS",
  "ZAR",
  "MAD",
] as const;

export type SupportedCurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

export const isSupportedCurrency = (code: string): code is SupportedCurrencyCode =>
  (SUPPORTED_CURRENCY_CODES as readonly string[]).includes(code);

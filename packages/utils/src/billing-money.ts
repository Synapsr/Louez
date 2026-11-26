import type { StoreSettings } from "@louez/types";

/**
 * The two billing-snapshot facts a store settings write compares before and
 * after (louez-billing docs/api): the store's currency code, and the tax rate
 * the dashboard adds on top of its totals.
 */

/** A store's or a row's currency as the billing contract counts it: three letters, EUR when unknown. */
export function normalizeCurrency(currency: string | null | undefined, fallback = "EUR"): string {
  const code = (currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

/**
 * The rate, in basis points, that a total the dashboard wrote is charged on
 * its untaxed lines, or null when the store's tax settings add no tax to such
 * a total. A tax settings change that moves it changes the totals of every
 * reservation whose total the dashboard wrote.
 */
export function beforeTaxRateBps(tax: StoreSettings["tax"] | null | undefined): number | null {
  if (tax?.enabled !== true || tax.displayMode !== "exclusive") return null;
  const rate = Number(tax.defaultRate ?? 0);
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : 0;
}

/**
 * Stripe's zero-decimal currencies (louez-billing fees.md §3): their amounts
 * are whole units, with no minor unit below.
 */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/** The three-decimal currencies, which the billing contract does not carry (fees.md §3). */
export const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BHD",
  "JOD",
  "KWD",
  "OMR",
  "TND",
]);

/**
 * The digits of a currency's minor unit as Louez and its billing count it:
 * 0 for a zero-decimal currency, 2 otherwise; null for a three-decimal
 * currency, which neither carries.
 */
export function currencyMinorDigits(currency: string): 0 | 2 | null {
  const code = currency.trim().toUpperCase();
  if (THREE_DECIMAL_CURRENCIES.has(code)) return null;
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
}

/**
 * An amount rounded down to its currency's minor unit (whole yen, cents):
 * what a charge of it may take, never more (¥100.60 charges ¥100). Counted
 * in hundredths first, so a stored 0.29 stays 0.29.
 */
export function roundDownToMinorUnit(amount: number, currency: string): number {
  const hundredths = Math.round(amount * 100);
  return ZERO_DECIMAL_CURRENCIES.has(currency.trim().toUpperCase())
    ? Math.floor(hundredths / 100)
    : hundredths / 100;
}

/**
 * The decimals to write a stored amount with, so that every digit its row
 * holds shows and none it does not: as many as the decimal string has
 * (`"1.49"` in yen is ¥1.49, never ¥1), except decimals that are all zeros,
 * left off past the currency's own (`"1500.00"` in yen is ¥1,500, `"3.50"`
 * in euros €3.50). One rule for every text that writes an amount: the
 * approval's page, a preview, a refusal.
 */
export function exactMoneyDecimals(amount: string, currency: string): number {
  const fraction = amount.split(".")[1] ?? "";
  const customary =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? fraction.length;
  return /^0*$/.test(fraction) ? Math.min(customary, fraction.length) : fraction.length;
}

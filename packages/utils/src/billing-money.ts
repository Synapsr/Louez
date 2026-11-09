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

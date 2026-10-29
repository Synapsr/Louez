import { formatCurrency } from "@louez/utils";

import { currencyExponent } from "@/lib/billing-sync/money";

// How the billing pages write the service's amounts, months and dates (louez-billing
// docs/api, README §3): integers in minor units, UTC months, and dates in the store's
// time zone, which the service gives with each read.

/** An amount in minor units of `currency`, written in `locale`. */
export function formatMinor(amountMinor: number, currency: string, locale: string): string {
  return formatCurrency(amountMinor / 10 ** currencyExponent(currency), currency, locale);
}

/** A `YYYY-MM` period as a title, such as "October 2026" or "Octobre 2026". */
export function formatPeriod(period: string, locale: string): string {
  const [year, month] = period.split("-").map(Number);
  const text = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** A timestamp as a day in `timeZone`, such as "1 November 2026". */
export function formatDay(timestamp: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(
    new Date(timestamp),
  );
}

/** Stripe's brand as people write it, such as `visa` → "Visa". */
export function cardBrandName(brand: string | null): string | null {
  if (!brand || brand === "unknown") return null;
  const names: Record<string, string> = {
    amex: "American Express",
    cartes_bancaires: "Cartes Bancaires",
    diners: "Diners Club",
    discover: "Discover",
    eftpos_au: "eftpos",
    jcb: "JCB",
    mastercard: "Mastercard",
    unionpay: "UnionPay",
    visa: "Visa",
  };
  return names[brand] ?? brand;
}

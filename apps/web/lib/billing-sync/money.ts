import type { StoreSettings } from "@louez/types";

// Integer money for the billing contract (louez-billing docs/api, fees.md §2-§4).
// Amounts are minor units as Stripe counts them. Nothing here goes through a float.

/** Stripe's zero-decimal currencies (fees.md §3; the list in lib/stripe.ts). */
const ZERO_DECIMAL = new Set([
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
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

// apps/web targets ES2017, which has no BigInt literals.
const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B5000 = BigInt(5000);
const B10000 = BigInt(10000);

export function normalizeCurrency(currency: string | null | undefined, fallback = "EUR"): string {
  const code = (currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

export function currencyExponent(currency: string): 0 | 2 {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export type MinorResult =
  | { readonly minor: number }
  | { readonly error: "unsupported_currency" | "invalid" };

/**
 * `toMinor` of fees.md §3: parse the decimal string, keep the currency's digits,
 * round half away from zero on the digits dropped.
 */
export function toMinor(decimal: string, currency: string): MinorResult {
  const code = currency.toUpperCase();
  if (THREE_DECIMAL.has(code)) return { error: "unsupported_currency" };
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) return { error: "invalid" };
  const exponent = currencyExponent(code);
  const fraction = match[3] ?? "";
  const kept = (fraction + "0".repeat(exponent)).slice(0, exponent);
  const dropped = fraction.slice(exponent);
  let value = BigInt(match[2] + kept);
  if (dropped.charAt(0) >= "5") value += B1;
  const signed = match[1] === "-" && value !== B0 ? -value : value;
  return { minor: Number(signed) };
}

/** `toMinor` for values Louez stored itself, such as `decimal(10,2)` columns. */
export function toMinorOrThrow(decimal: string | null | undefined, currency: string): number {
  const result = toMinor(decimal ?? "0", currency);
  if ("error" in result)
    throw new Error(`cannot convert an amount to minor units (${result.error})`);
  return result.minor;
}

/** fees.md §2: half up, for x ≥ 0 and bps ≥ 0. */
export function rhu(x: bigint, bps: bigint): bigint {
  return (x * bps + B5000) / B10000;
}

/** fees.md §2: round(a × n / d) half up, for a, n ≥ 0 and d > 0. */
export function mulDivHalfUp(a: bigint, n: bigint, d: bigint): bigint {
  return (B2 * a * n + d) / (B2 * d);
}

/** fees.md §4: the insurance part of one payment. */
export function insuranceShare(input: {
  readonly insuranceMinor: number;
  readonly grossMinor: number;
  readonly totalInclTaxMinor: number;
}): number {
  const insurance = BigInt(input.insuranceMinor);
  const gross = BigInt(input.grossMinor);
  const total = BigInt(input.totalInclTaxMinor);
  if (insurance <= B0 || gross <= B0 || total <= B0) return 0;
  let share = mulDivHalfUp(insurance, gross, total);
  if (share > insurance) share = insurance;
  if (share > gross) share = gross;
  return Number(share);
}

export type ReservationTotalsInput = {
  readonly reservation: {
    readonly currency: string | null;
    readonly totalAmount: string;
    readonly subtotalAmount: string;
    readonly depositAmount: string;
    readonly tulipInsuranceAmount: string | null;
  };
  readonly storeSettings: Pick<StoreSettings, "currency" | "tax"> | null;
  /** The reservation's items, insurance line included. */
  readonly items: ReadonlyArray<{
    readonly productId: string | null;
    readonly taxRate: string | null;
    readonly totalPrice: string;
  }>;
};

export type ReservationTotalsMinor = {
  readonly currency: string;
  /** What the renter is billed, tax included, deposit excluded (contract Q6). */
  readonly totalInclTaxMinor: number;
  readonly insuranceMinor: number;
};

/**
 * The reservation's tax-included total and insurance, in minor units (contract Q6).
 *
 * `total_amount` is tax included except in one case: a store that prices excluding
 * tax, for a reservation created or edited from the dashboard. Those writes store
 * items without a tax rate and a total before tax. The total then gets the store's
 * default rate on everything but the insurance, which is VAT-exempt, so the
 * service never receives an excluding-tax total. Old rows whose total includes the
 * deposit are read the way `getReservationRentalAmount` reads them.
 */
export function reservationTotalsMinor(input: ReservationTotalsInput): ReservationTotalsMinor {
  const currency = normalizeCurrency(input.reservation.currency ?? input.storeSettings?.currency);
  const minor = (value: string | null) => toMinorOrThrow(value, currency);

  const subtotal = minor(input.reservation.subtotalAmount);
  const deposit = minor(input.reservation.depositAmount);
  let total = minor(input.reservation.totalAmount);
  if (total > 0 && deposit > 0 && total - subtotal >= deposit - 1)
    total = Math.max(0, total - deposit);

  const insurance = Math.max(0, minor(input.reservation.tulipInsuranceAmount));
  const tax = input.storeSettings?.tax;
  const pricedBeforeTax =
    tax?.enabled === true &&
    tax.displayMode === "exclusive" &&
    input.items.some(
      (item) =>
        item.taxRate === null &&
        !(item.productId === null && insurance > 0 && minor(item.totalPrice) === insurance),
    );
  if (pricedBeforeTax && total > 0) {
    const rateBps = BigInt(Math.round(Number(tax.defaultRate ?? 0) * 100));
    const taxable = BigInt(Math.max(0, total - insurance));
    total += Number(rhu(taxable, rateBps));
  }
  return { currency, totalInclTaxMinor: Math.max(0, total), insuranceMinor: insurance };
}

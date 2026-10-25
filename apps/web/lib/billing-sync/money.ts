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

/**
 * Before this date some reservations stored a total that included the deposit.
 * Commit 954a509f (2026-03-19) made every writer exclude it; the margin covers the
 * deploy. Later rows never get the deposit taken out, because their total minus
 * subtotal can exceed the deposit for honest reasons (delivery, tax).
 */
export const DEPOSIT_EXCLUDED_FROM_TOTAL_SINCE = new Date("2026-04-01T00:00:00Z");

export type ReservationTotalsInput = {
  readonly reservation: {
    readonly createdAt: Date;
    readonly currency: string | null;
    /** `manual` when the dashboard created the row; the storefront checkout writes the others. */
    readonly source: string | null;
    readonly totalAmount: string;
    readonly subtotalAmount: string;
    readonly depositAmount: string;
    readonly deliveryFee: string | null;
    readonly discountAmount: string | null;
    /** The tax engine's split of the total; the dashboard never writes it. */
    readonly subtotalExclTax: string | null;
    readonly taxAmount: string | null;
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

type ToMinor = (value: string | null) => number;

/**
 * The reservation's tax-included total and insurance, in minor units (contract Q6).
 *
 * `total_amount` is tax included except when the dashboard wrote it in a store that
 * prices excluding tax: manual creation and edits store a total with no tax on top.
 * That total gets the tax the checkout would add (`taxOnTopMinor`), so the service
 * never receives an excluding-tax total. `writtenByDashboard` tells the writers apart
 * from what each one leaves on the row.
 *
 * The row does not record the display mode the dashboard priced under, so such a
 * total follows the store's tax settings as they are now, and a change of
 * `beforeTaxRateBps` moves it. Rows from before DEPOSIT_EXCLUDED_FROM_TOTAL_SINCE whose
 * total includes the deposit are read the way `getReservationRentalAmount` reads them.
 */
export function reservationTotalsMinor(input: ReservationTotalsInput): ReservationTotalsMinor {
  const { reservation } = input;
  const currency = normalizeCurrency(reservation.currency ?? input.storeSettings?.currency);
  const minor: ToMinor = (value) => toMinorOrThrow(value, currency);

  const subtotal = minor(reservation.subtotalAmount);
  const deposit = minor(reservation.depositAmount);
  let total = minor(reservation.totalAmount);
  const mayIncludeDeposit = reservation.createdAt < DEPOSIT_EXCLUDED_FROM_TOTAL_SINCE;
  if (mayIncludeDeposit && total > 0 && deposit > 0 && total - subtotal >= deposit - 1) {
    total = Math.max(0, total - deposit);
  }

  const insurance = Math.max(0, minor(reservation.tulipInsuranceAmount));
  const defaultBps = beforeTaxRateBps(input.storeSettings?.tax);
  if (defaultBps !== null && total > 0 && writtenByDashboard(reservation, total, minor)) {
    total += taxOnTopMinor(input, insurance, BigInt(defaultBps), minor);
  }
  return { currency, totalInclTaxMinor: Math.max(0, total), insuranceMinor: insurance };
}

/**
 * The rate, in basis points, that `reservationTotalsMinor` charges on the untaxed
 * lines of a total the dashboard wrote, or null when the store's tax settings add
 * no tax to such a total. A tax settings change that moves it changes the totals
 * of every reservation whose total the dashboard wrote.
 */
export function beforeTaxRateBps(tax: StoreSettings["tax"] | null | undefined): number | null {
  if (tax?.enabled !== true || tax.displayMode !== "exclusive") return null;
  const rate = Number(tax.defaultRate ?? 0);
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) : 0;
}

/** Within one minor unit: each writer sums floats before it rounds to cents. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/**
 * Whether the dashboard wrote the total, from what each writer leaves on the row.
 * The tax engine (storefront checkout, extensions) stores its split beside the
 * total, and the split adds up to the total in either display mode. The dashboard
 * stores subtotal + delivery − discount, the subtotal holding the insurance, and
 * leaves the split as it was: absent on a row it created, stale on a checkout row it
 * edited.
 *
 * A checkout row with no split was booked with taxes off, so its total is what the
 * renter was charged, whatever the store's settings are now. The row keeps no trace
 * of a later dashboard edit of such a booking, which this reads the same way.
 */
function writtenByDashboard(
  reservation: ReservationTotalsInput["reservation"],
  total: number,
  minor: ToMinor,
): boolean {
  const hasSplit = reservation.subtotalExclTax !== null && reservation.taxAmount !== null;
  if (hasSplit && near(total, minor(reservation.subtotalExclTax) + minor(reservation.taxAmount)))
    return false;
  const sum =
    minor(reservation.subtotalAmount) +
    minor(reservation.deliveryFee) -
    minor(reservation.discountAmount);
  if (!near(total, sum)) return false;
  return reservation.source === "manual" || hasSplit;
}

/**
 * The tax the checkout adds to a before-tax total, as `calculateTaxBreakdown` does
 * in exclusive mode: each item at its own rate, or at the store's default when it
 * has none, the delivery at the default rate, and the insurance line exempt
 * (art. 261 C CGI). The discount comes off the taxed lines first, spread in
 * proportion by largest remainder.
 */
function taxOnTopMinor(
  input: ReservationTotalsInput,
  insurance: number,
  defaultBps: bigint,
  minor: ToMinor,
): number {
  const lines: Array<{ readonly amount: bigint; readonly bps: bigint }> = [];
  let insuranceLineFound = insurance <= 0;
  for (const item of input.items) {
    const amount = minor(item.totalPrice);
    if (!insuranceLineFound && item.productId === null && amount === insurance) {
      insuranceLineFound = true;
      continue;
    }
    const bps = item.taxRate === null ? defaultBps : percentToBps(item.taxRate);
    lines.push({ amount: BigInt(Math.max(0, amount)), bps });
  }
  const delivery = minor(input.reservation.deliveryFee);
  if (delivery > 0) lines.push({ amount: BigInt(delivery), bps: defaultBps });

  const discounts = spreadByLargestRemainder(
    BigInt(Math.max(0, minor(input.reservation.discountAmount))),
    lines.map((line) => line.amount),
  );
  let tax = B0;
  lines.forEach((line, index) => {
    tax += rhu(line.amount - discounts[index], line.bps);
  });
  return Number(tax);
}

/** A stored `decimal(5,2)` percentage in basis points; a negative rate reads as 0. */
function percentToBps(percent: string): bigint {
  // Read with two decimals, as EUR is, a percentage counts hundredths of a percent.
  return BigInt(Math.max(0, toMinorOrThrow(percent, "EUR")));
}

/** `discount` spread over `amounts` in proportion, by largest remainder, capped at their sum. */
function spreadByLargestRemainder(discount: bigint, amounts: readonly bigint[]): bigint[] {
  const sum = amounts.reduce((acc, amount) => acc + amount, B0);
  const spread = discount < sum ? discount : sum;
  if (spread === B0) return amounts.map(() => B0);
  const shares = amounts.map((amount) => (spread * amount) / sum);
  let left = spread - shares.reduce((acc, share) => acc + share, B0);
  const byRemainder = amounts
    .map((amount, index) => ({ index, remainder: (spread * amount) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of byRemainder) {
    if (left === B0) break;
    shares[index] += B1;
    left -= B1;
  }
  return shares;
}

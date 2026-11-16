import { currencyMinorDigits } from "@louez/utils";

/**
 * The amount a payment written by hand takes (`dashboard.payments.record`,
 * `recordDepositReturn`, `recordRefund`), whatever its currency: a plain decimal, an optional minus sign, one to
 * eight integer digits, at most two decimals, and not zero. That is exactly
 * what its row, `payments.amount` (`decimal(10,2)`), holds as sent: no
 * rounding, no text MySQL would read otherwise ("1e2", " 5", "+5", "5.",
 * "12abc"). The one rule: the writes refuse any other text before they ask
 * anyone, and the displays a person reads show the amount it returns.
 *
 * Returns the text the row will hold, every decimal written ("120" holds
 * "120.00", "007.5" holds "7.50"), or null for a text the writes refuse.
 * Pure, and light: the page's tests and the sample approvals use it too.
 */
export function paymentAmount(raw: string): string | null {
  const match = /^(-?)(\d{1,8})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  // At most ten digits: an exact integer.
  const cents = Number(whole + fraction.padEnd(2, "0"));
  if (cents === 0) return null;
  const digits = String(cents).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Why a payment's amount is refused: its text, its sign for its type, or its currency. */
export type RecordedAmountVerdict =
  | { ok: true; amount: string }
  | {
      ok: false;
      refusal: "amount_invalid" | "negative_outside_adjustment" | Exclude<CurrencyFit, "fits">;
    };

/**
 * The amount of a payment recorded (`dashboard.payments.record`), as the
 * write judges it before it asks: `paymentAmount`, then a negative amount
 * for an adjustment only, then, in the reservation's `currency`,
 * `currencyFit`. The display of a payment recorded judges it the same way.
 */
export function recordedPaymentAmount(
  raw: string,
  type: string,
  currency: string,
): RecordedAmountVerdict {
  const amount = paymentAmount(raw);
  if (!amount) return { ok: false, refusal: "amount_invalid" };
  if (amount.startsWith("-") && type !== "adjustment") {
    return { ok: false, refusal: "negative_outside_adjustment" };
  }
  const fit = currencyFit(amount, currency);
  if (fit !== "fits") return { ok: false, refusal: fit };
  return { ok: true, amount };
}

export type DepositReturnVerdict =
  | { ok: true; amount: string }
  | { ok: false; refusal: "amount_invalid" | Exclude<CurrencyFit, "fits"> | "exceeds_balance" };

/**
 * The amount of a deposit return (`dashboard.payments.recordDepositReturn`,
 * and the dashboard's own return), as the write judges it before it asks:
 * `paymentAmount`, above zero; then, in the reservation's `currency`,
 * `currencyFit`; then within `returnableHundredths`, the deposit collected
 * and not yet returned (`depositBalance`) as the write counts it under the
 * reservation's lock. Its display judges it the same way.
 */
export function depositReturnAmount(
  raw: string,
  currency: string,
  returnableHundredths: number,
): DepositReturnVerdict {
  const amount = paymentAmount(raw);
  if (!amount || amount.startsWith("-")) return { ok: false, refusal: "amount_invalid" };
  const fit = currencyFit(amount, currency);
  if (fit !== "fits") return { ok: false, refusal: fit };
  if (hundredthsOf(amount) > returnableHundredths) {
    return { ok: false, refusal: "exceeds_balance" };
  }
  return { ok: true, amount };
}

/** A reservation's deposit, in hundredths: collected, returned, and still returnable. */
export interface DepositBalanceHundredths {
  collected: number;
  returned: number;
  returnable: number;
}

/**
 * The deposit a reservation's payments hold, counted in hundredths, as exact
 * integers (`hundredthsOf`): its completed `deposit` rows, its completed
 * `deposit_return` rows, and the difference. Never in floating point, where
 * €0.30 less €0.10 is 0.19999999999999998 and a return of €0.20 would not
 * fit. Hundredths are the unit the rows hold (`decimal(10,2)`), whatever
 * their currency, as for the refund's ceiling: a yen is a hundred of them.
 */
export function depositBalance(
  rows: ReadonlyArray<{ type: string; status: string; amount: string }>,
): DepositBalanceHundredths {
  const completed = (type: string) =>
    rows
      .filter((row) => row.type === type && row.status === "completed")
      .reduce((sum, row) => sum + hundredthsOf(row.amount), 0);
  const collected = completed("deposit");
  const returned = completed("deposit_return");
  return { collected, returned, returnable: collected - returned };
}

/**
 * A stored or accepted amount (`decimal(10,2)`, "80.00", "-20.00") in
 * hundredths, as an exact integer, whatever its currency: what the
 * refund's ceiling is counted in.
 */
export function hundredthsOf(amount: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return Number.NaN;
  const [, sign = "", whole = "", fraction = ""] = match;
  const hundredths = Number(whole + fraction.padEnd(2, "0"));
  return sign ? -hundredths : hundredths;
}

/** Hundredths written back as a plain decimal with two places ("-2000" is "-20.00"). */
export function fromHundredths(hundredths: number): string {
  const digits = String(Math.abs(hundredths)).padStart(3, "0");
  return `${hundredths < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * An amount that fits its currency (`currencyFit`) in that currency's minor
 * units: yen for yen, cents for euros. What an approval binds.
 */
export function currencyMinorOf(amount: string, currency: string): number {
  const hundredths = hundredthsOf(amount);
  return currencyMinorDigits(currency) === 0 ? hundredths / 100 : hundredths;
}

/** Why an amount does not fit its currency: digits past its minor unit, or a currency Louez does not count. */
export type CurrencyFit = "fits" | "too_precise" | "currency_unsupported";

/**
 * Whether an amount `paymentAmount` accepted fits `currency`: no non-zero
 * digit past the currency's minor unit (`currencyMinorDigits`: none in yen,
 * two in euros), in a currency Louez's billing counts (not a three-decimal
 * one). "1.00" fits yen, "0.50" does not.
 */
export function currencyFit(amount: string, currency: string): CurrencyFit {
  const digits = currencyMinorDigits(currency);
  if (digits === null) return "currency_unsupported";
  const fraction = amount.split(".")[1] ?? "";
  return /^0*$/.test(fraction.slice(digits)) ? "fits" : "too_precise";
}

export type RefundVerdict =
  | { ok: true; amount: string }
  | {
      ok: false;
      refusal: "amount_invalid" | "too_precise" | "currency_unsupported" | "exceeds_refundable";
    };

/**
 * The amount of a refund given by hand (`dashboard.payments.recordRefund`),
 * as the write judges it before it asks: `paymentAmount`, above zero; then,
 * in the payment's `currency`, `currencyFit`; then at most
 * `refundableHundredths`, the payment's amount less the completed refunds
 * linked to it, as the write counts it under the reservation's lock.
 * Its display judges it the same way.
 */
export function refundAmount(
  raw: string,
  currency: string,
  refundableHundredths: number,
): RefundVerdict {
  const amount = paymentAmount(raw);
  if (!amount || amount.startsWith("-")) return { ok: false, refusal: "amount_invalid" };
  const fit = currencyFit(amount, currency);
  if (fit !== "fits") return { ok: false, refusal: fit };
  if (hundredthsOf(amount) > refundableHundredths) {
    return { ok: false, refusal: "exceeds_refundable" };
  }
  return { ok: true, amount };
}

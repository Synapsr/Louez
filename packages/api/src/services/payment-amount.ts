/**
 * The amount a payment written by hand takes (`dashboard.payments.record`,
 * `recordDepositReturn`): a plain decimal, an optional minus sign, one to
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

/** Why a payment's amount is refused: its text, or its sign for its type. */
export type RecordedAmountVerdict =
  | { ok: true; amount: string }
  | { ok: false; refusal: "amount_invalid" | "negative_outside_adjustment" };

/**
 * The amount of a payment recorded (`dashboard.payments.record`), as the
 * write judges it before it asks: `paymentAmount`, then a negative amount
 * for an adjustment only. The display of a payment recorded judges it the
 * same way.
 */
export function recordedPaymentAmount(raw: string, type: string): RecordedAmountVerdict {
  const amount = paymentAmount(raw);
  if (!amount) return { ok: false, refusal: "amount_invalid" };
  if (amount.startsWith("-") && type !== "adjustment") {
    return { ok: false, refusal: "negative_outside_adjustment" };
  }
  return { ok: true, amount };
}

export type DepositReturnVerdict =
  | { ok: true; amount: string }
  | { ok: false; refusal: "amount_invalid" | "exceeds_balance" };

/**
 * The amount of a deposit return (`dashboard.payments.recordDepositReturn`),
 * as the write judges it before it asks: `paymentAmount`, above zero, and
 * within `returnable`, the deposit collected and not yet returned as the
 * write counts it under the reservation's lock. Its display judges it the
 * same way.
 */
export function depositReturnAmount(raw: string, returnable: number): DepositReturnVerdict {
  const amount = paymentAmount(raw);
  if (!amount || amount.startsWith("-")) return { ok: false, refusal: "amount_invalid" };
  if (parseFloat(amount) > returnable) return { ok: false, refusal: "exceeds_balance" };
  return { ok: true, amount };
}

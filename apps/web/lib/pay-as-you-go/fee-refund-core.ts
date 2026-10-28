import { mulDivHalfUp } from "@/lib/billing-sync/money";

// The legacy ledger's share of an application fee refund (louez-billing docs/api,
// fees.md §9): Stripe's refunded amount of the fee, split over the rows Stripe took
// that fee for, in proportion to their amounts. Pure.

export type FeeRowRefund<Row> = {
  readonly row: Row;
  /** The row's part of Stripe's `fee.amount_refunded`, from 0 to its amount. */
  readonly amountReversedCents: number;
  readonly fullyReversed: boolean;
};

/**
 * Splits `refundedMinor` over `rows`, in their order: each row gets `mulDivHalfUp` of
 * its amount and the last row takes the rest. A refund larger than the rows (a fee
 * part Louez recorded as 0) is capped at their total.
 */
export function splitFeeRefund<Row extends { readonly amountCents: number }>(
  rows: readonly Row[],
  refundedMinor: number,
): Array<FeeRowRefund<Row>> {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.amountCents), 0);
  const refunded = Math.min(Math.max(0, refundedMinor), total);
  let left = refunded;
  return rows.map((row, index) => {
    const amount = Math.max(0, row.amountCents);
    const share =
      index === rows.length - 1 || total === 0
        ? left
        : Number(mulDivHalfUp(BigInt(refunded), BigInt(amount), BigInt(total)));
    const reversed = Math.min(amount, Math.max(0, share));
    left -= reversed;
    return { row, amountReversedCents: reversed, fullyReversed: amount > 0 && reversed >= amount };
  });
}

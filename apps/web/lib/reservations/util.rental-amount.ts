/**
 * Before this date the storefront checkout stored a total that included the
 * deposit. Commit 954a509f (2026-03-19) made every writer exclude it; the
 * margin covers the deploy.
 */
export const DEPOSIT_EXCLUDED_FROM_TOTAL_SINCE = new Date("2026-04-01T00:00:00Z");

/**
 * Whether a reservation's stored total may still include its deposit: only a
 * row written before DEPOSIT_EXCLUDED_FROM_TOTAL_SINCE, and never repriced
 * since. A recorded display mode (migration 0107) means a writer of today wrote
 * its total — a creation, an edit, a date change or an extension — and none of
 * them puts the deposit in it. Any later row's total can exceed its subtotal by
 * the deposit or more for honest reasons: the tax added to prices given before
 * tax, the delivery.
 */
export function totalMayIncludeDeposit(reservation: {
  readonly createdAt: Date | string;
  readonly taxDisplayMode?: string | null;
}): boolean {
  if (reservation.taxDisplayMode) return false;
  const createdAt = new Date(reservation.createdAt);
  return createdAt.getTime() < DEPOSIT_EXCLUDED_FROM_TOTAL_SINCE.getTime();
}

/**
 * What a reservation's rental costs, without its deposit: its stored total,
 * tax included, less the deposit only for a row whose total demonstrably holds
 * it (`totalMayIncludeDeposit`, and a total that exceeds the subtotal by the
 * deposit). The one rule for what is asked and shown as owed for the rental.
 */
export function getReservationRentalAmount(reservation: {
  readonly subtotalAmount: string | null;
  readonly depositAmount: string | null;
  readonly totalAmount: string | null;
  readonly createdAt: Date | string;
  readonly taxDisplayMode?: string | null;
}): number {
  const subtotal = parseFloat(reservation.subtotalAmount || "0");
  const deposit = parseFloat(reservation.depositAmount || "0");
  const total = parseFloat(reservation.totalAmount || "0");

  if (!Number.isFinite(total) || total <= 0) return subtotal;
  if (deposit > 0 && totalMayIncludeDeposit(reservation) && total - subtotal >= deposit - 0.01) {
    return Math.max(0, total - deposit);
  }

  return total;
}

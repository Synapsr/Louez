import { countBillableReservationsWithoutBillableAt, db } from "@louez/db";

import { log } from "@/lib/evlog";

/**
 * The nightly `billable_at` invariant: billable reservations without the date.
 * The legacy fee report cannot see them, since it reads `billable_at`. Logs an
 * error when there are any.
 */
export async function checkBillableAt(
  options: { log?: { error(tag: string, message: string): void } } = {},
): Promise<{ missing: number }> {
  const missing = await countBillableReservationsWithoutBillableAt(db);
  if (missing > 0) {
    (options.log ?? log).error(
      "billing",
      `${missing} billable reservations have no billable_at. Run pnpm --filter @louez/db reservations:backfill-billable-at --apply.`,
    );
  }
  return { missing };
}

import { and, count, inArray, isNull } from "drizzle-orm";

import type { Database, Transaction } from "./index";
import { reservations } from "./schema";

const BILLABLE_STATUSES = ["confirmed", "ongoing", "completed"] as const;

/**
 * Billable reservations that have no `billable_at`. It should be 0: migration
 * 0083 fills older rows, and new rows get the date when they become billable.
 * Rows confirmed by an older version during a deploy, and databases built with
 * `db:push`, can still miss it: run `reservations:backfill-billable-at --apply`.
 */
export async function countBillableReservationsWithoutBillableAt(
  database: Database | Transaction,
): Promise<number> {
  const [row] = await database
    .select({ missing: count() })
    .from(reservations)
    .where(
      and(inArray(reservations.status, [...BILLABLE_STATUSES]), isNull(reservations.billableAt)),
    );
  return row?.missing ?? 0;
}

import { markReservation } from "./billing-queue";
import type { Transaction } from "./index";
import {
  isBillableReservationStatus,
  toWholeSeconds,
  type ReservationBillingEffect,
  type ReservationStatus,
} from "./reservation-status";
import { reservations } from "./schema";

/**
 * A new reservation. The status is explicit, because the column defaults to
 * `pending`, and limited to what a booking can start as. The billing dates
 * belong to the helpers.
 */
export type ReservationInsertValues = Omit<
  typeof reservations.$inferInsert,
  "id" | "status" | "billableAt" | "withdrawnAt"
> & { id: string; status: "pending" | "quote" | "confirmed" };

/** `at` for a billable status, else null. Seeds use it for backdated rows. */
export function initialBillableAt(status: ReservationStatus, at: Date): Date | null {
  return isBillableReservationStatus(status) ? at : null;
}

/** The row `insertReservation` writes and the effects it returns. */
export function planReservationInsert(
  values: ReservationInsertValues,
  now: Date,
): { row: typeof reservations.$inferInsert; effects: ReservationBillingEffect[] } {
  const at = toWholeSeconds(now);
  const billableAt = initialBillableAt(values.status, at);
  const row = { ...values, billableAt };
  if (!billableAt) return { row, effects: [] };

  return {
    row,
    effects: [
      {
        type: "legacy_fee.record",
        storeId: values.storeId,
        reservationId: values.id,
        marketplace: values.source === "marketplace",
        at,
      },
    ],
  };
}

/**
 * The one way to insert a reservation at runtime. It writes no activity row and
 * consumes no stock: callers insert the items afterwards and log `created`
 * themselves. It returns the fee effects; the caller runs them after commit.
 */
export async function insertReservation(
  tx: Transaction,
  values: ReservationInsertValues,
  options: { now?: Date } = {},
): Promise<{ effects: ReservationBillingEffect[] }> {
  const plan = planReservationInsert(values, options.now ?? new Date());
  await tx.insert(reservations).values(plan.row);
  await markReservation(tx, { id: values.id, storeId: values.storeId });
  return { effects: plan.effects };
}

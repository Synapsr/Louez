import { and, asc, eq, inArray } from "drizzle-orm";

import { validateReservationContract } from "@louez/api/services";
import { changeReservationStatus, products, reservationItems, reservations } from "@louez/db";
import type {
  ChangeReservationStatusInput,
  ChangeReservationStatusResult,
  Transaction,
} from "@louez/db";

import { resolveDateChangeRequests } from "@/lib/reservations/date-change-request.server";
import { checkExistingReservationInventory } from "@/lib/reservations/reserve-inventory";

export type StoreStatusChangeInput = Omit<ChangeReservationStatusInput, "beforeWrite"> & {
  /** The rental dates, to settle the pending return-date requests. */
  dates: { startDate: Date; endDate: Date };
};

/**
 * Locks the reservation's products, by id, before the reservation itself: the
 * order of every writer of products and their bookings (store, products,
 * reservations, units; docs/code-review/04-data-layer.md, DL-12). A product
 * update holding a product then never waits for a reservation this holds.
 * The product ids are a plain read: the caller's transaction runs READ
 * COMMITTED, so it takes no snapshot.
 */
async function lockReservationProductRows(tx: Transaction, reservationId: string, storeId: string) {
  const lines = await tx
    .selectDistinct({ productId: reservationItems.productId })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(eq(reservationItems.reservationId, reservationId), eq(reservations.storeId, storeId)),
    );
  const productIds = lines.flatMap((line) => (line.productId ? [line.productId] : [])).sort();
  if (productIds.length === 0) return;
  await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
    .orderBy(asc(products.id))
    .for("update");
}

/**
 * A status change the store asks for, in the caller's transaction, which runs
 * READ COMMITTED. It locks the reservation's products first, then the
 * reservation. Before a confirmation it checks that the items are still free.
 * After the change it validates the contract and settles the return-date
 * requests. The caller runs the returned effects after commit.
 */
export async function changeStoreReservationStatus(
  tx: Transaction,
  { dates, ...input }: StoreStatusChangeInput,
): Promise<ChangeReservationStatusResult> {
  const { reservationId, storeId } = input;
  await lockReservationProductRows(tx, reservationId, storeId);
  const change = await changeReservationStatus(tx, {
    ...input,
    beforeWrite: async (lockedTx, { from, to }) => {
      // Only this change consumes stock.
      if (to === "confirmed" && (from === "pending" || from === "quote")) {
        await checkExistingReservationInventory(lockedTx, reservationId, storeId);
      }
    },
  });
  if (!change.changed) return change;

  // It does nothing unless the reservation is now billable and not yet signed.
  await validateReservationContract(tx, reservationId, storeId, "confirmation");
  await resolveDateChangeRequests(tx, reservationId, dates.startDate, dates.endDate, change.to);
  return change;
}

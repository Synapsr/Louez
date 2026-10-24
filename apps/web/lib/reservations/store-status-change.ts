import { validateReservationContract } from "@louez/api/services";
import { changeReservationStatus } from "@louez/db";
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
 * A status change the store asks for, in the caller's transaction. Before a
 * confirmation it checks that the items are still free. After the change it
 * validates the contract and settles the return-date requests. The caller runs
 * the returned effects after commit.
 */
export async function changeStoreReservationStatus(
  tx: Transaction,
  { dates, ...input }: StoreStatusChangeInput,
): Promise<ChangeReservationStatusResult> {
  const { reservationId, storeId } = input;
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

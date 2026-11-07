import { and, asc, eq, inArray } from "drizzle-orm";

import { validateReservationContract } from "@louez/api/services";
import {
  changeReservationStatus,
  isDatabaseDeadlock,
  products,
  reservationItems,
  reservations,
  retryTransactionOnDeadlock,
} from "@louez/db";
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
 * The reservation got a product while its status change waited for its lock
 * (an edit added a line): that product is not locked, and locking it now,
 * behind the reservation, would invert the lock order. The transaction rolls
 * back and starts over (`retryStoreStatusChange`).
 */
export class ReservationProductsChangedError extends Error {
  constructor(readonly reservationId: string) {
    super("The reservation's products changed while its status change waited for it.");
    this.name = "ReservationProductsChangedError";
  }
}

/** The ids of the reservation's products, sorted. A plain read: the transaction runs READ COMMITTED. */
async function reservationProductIds(tx: Transaction, reservationId: string, storeId: string) {
  const lines = await tx
    .selectDistinct({ productId: reservationItems.productId })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
    .where(
      and(eq(reservationItems.reservationId, reservationId), eq(reservations.storeId, storeId)),
    );
  return lines.flatMap((line) => (line.productId ? [line.productId] : [])).sort();
}

/**
 * Locks the reservation's products, by id, before the reservation itself: the
 * order of every writer of products and their bookings (store, products,
 * reservations, units; docs/code-review/04-data-layer.md, DL-12). A product
 * update holding a product then never waits for a reservation this holds.
 * Returns the ids it locked.
 */
async function lockReservationProductRows(tx: Transaction, reservationId: string, storeId: string) {
  const productIds = await reservationProductIds(tx, reservationId, storeId);
  if (productIds.length > 0) {
    await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
      .orderBy(asc(products.id))
      .for("update");
  }
  return new Set(productIds);
}

/** Most runs of a store's status change: a deadlock or new products start it over. */
const STORE_STATUS_CHANGE_ATTEMPTS = 3;

/**
 * Runs a store status change's transaction, again from the start when it lost
 * a deadlock or the reservation got a product meanwhile, up to three runs.
 * The caller runs the change's effects after this returns.
 */
export function retryStoreStatusChange<T>(transaction: () => Promise<T>): Promise<T> {
  return retryTransactionOnDeadlock(transaction, {
    attempts: STORE_STATUS_CHANGE_ATTEMPTS,
    retryOn: (error) =>
      isDatabaseDeadlock(error) || error instanceof ReservationProductsChangedError,
  });
}

/** Still conflicting after the last run: nothing was written, the caller may try again. */
export function isStoreStatusChangeConflict(error: unknown): boolean {
  return isDatabaseDeadlock(error) || error instanceof ReservationProductsChangedError;
}

/**
 * A status change the store asks for, in the caller's transaction, which runs
 * READ COMMITTED inside `retryStoreStatusChange`. It locks the reservation's
 * products first, then the reservation, and checks under that lock that no
 * product was added meanwhile. Before a confirmation it checks that the items
 * are still free. After the change it validates the contract and settles the
 * return-date requests. The caller runs the returned effects after commit.
 */
export async function changeStoreReservationStatus(
  tx: Transaction,
  { dates, ...input }: StoreStatusChangeInput,
): Promise<ChangeReservationStatusResult> {
  const { reservationId, storeId } = input;
  const locked = await lockReservationProductRows(tx, reservationId, storeId);
  const change = await changeReservationStatus(tx, {
    ...input,
    beforeWrite: async (lockedTx, { from, to }) => {
      // The reservation is locked now: a product it got meanwhile was never
      // locked, and every product lock from here on would come behind it.
      const current = await reservationProductIds(lockedTx, reservationId, storeId);
      if (current.some((productId) => !locked.has(productId))) {
        throw new ReservationProductsChangedError(reservationId);
      }
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

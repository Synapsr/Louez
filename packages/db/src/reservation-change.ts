import { and, eq } from "drizzle-orm";

import { deadlockRetryDelayMs, isDatabaseDeadlock } from "./deadlock";
import { db, type Transaction } from "./index";
import {
  closeReservationTransaction,
  isReservationProductsChangedError,
  lockReservationInTransaction,
  lockReservationOnlyInTransaction,
  openReservationTransaction,
  reservationChangeTestHooks,
  type ReservationOnlyLock,
  type ReservationProductsLock,
  type ReservationScope,
  type ReservationStatusLock,
  type ReservationTransaction,
} from "./reservation-lock";
import type { ReservationStatus } from "./reservation-status";
import { reservations } from "./schema";

/** Most runs of an owner transaction: a lost deadlock, a product added or a status changed starts it over. */
const RESERVATION_CHANGE_RUNS = 3;

/**
 * The owner transaction lost a deadlock, or saw the reservation's products or
 * status change, on each of its runs. Nothing was written. Each caller answers
 * it its own way (docs/domain/reservation-changes.md, slice 1, lists them): a
 * caller swallows it only when something really runs the change again later.
 */
export class ReservationChangeBusyError extends Error {
  constructor(
    readonly reservationId: string | null,
    options: { cause: unknown },
  ) {
    super("The reservation stayed busy for every run of its change.", options);
    this.name = "ReservationChangeBusyError";
  }
}

/** Read by name too: a test or a bundle may load this module twice. */
export function isReservationChangeBusyError(error: unknown): error is ReservationChangeBusyError {
  return (
    error instanceof ReservationChangeBusyError ||
    (error instanceof Error && error.name === "ReservationChangeBusyError")
  );
}

/**
 * The reservation's status changed between the plain read that chose its lock
 * and the lock (`runReservationChangeByStatus`): the run starts over from the
 * read, with the lock the new status needs.
 */
class ReservationStatusChangedError extends Error {
  constructor(readonly reservationId: string) {
    super("The reservation's status changed while its change waited for it.");
    this.name = "ReservationStatusChangedError";
  }
}

const startsOver = (error: unknown) =>
  isDatabaseDeadlock(error) ||
  isReservationProductsChangedError(error) ||
  error instanceof ReservationStatusChangedError;

/**
 * The owner entry: opens a READ COMMITTED transaction, whatever the
 * session's default, and runs `work` in it with the owner token that the
 * lock entries take. A lost deadlock, `ReservationProductsChangedError` from
 * a lock, or a status changed under `runReservationChangeByStatus`, rolls the
 * transaction back and runs the whole of it again, three runs in all; then it
 * throws `ReservationChangeBusyError`. Every token issued in it, an inserted
 * reservation's included, stops working when it ends, committed or not.
 *
 * `work` may run three times: it holds no outside effect. Messages go to the
 * outbox in it; fees, e-mails, notifications, Stripe, the insurer and the
 * page cache come after this returns, once.
 */
export async function runReservationTransaction<T>(
  work: (tx: Transaction, owner: ReservationTransaction) => Promise<T>,
  options: { reservationId?: string } = {},
): Promise<T> {
  for (let run = 1; ; run += 1) {
    try {
      return await db.transaction(
        async (tx) => {
          const owner = openReservationTransaction(tx);
          try {
            return await work(tx, owner);
          } finally {
            closeReservationTransaction(owner);
          }
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      if (!startsOver(error)) throw error;
      if (run >= RESERVATION_CHANGE_RUNS) {
        throw new ReservationChangeBusyError(options.reservationId ?? null, { cause: error });
      }
      reservationChangeTestHooks().restarts += 1;
      await new Promise((done) => setTimeout(done, deadlockRetryDelayMs(run)));
    }
  }
}

/**
 * A reservation's change under its locks: its products by id, then the
 * reservation (`lockReservationInTransaction`), in a transaction of the owner
 * entry. The token `work` receives allows any status change.
 */
export function runReservationChange<T>(
  scope: ReservationScope,
  work: (tx: Transaction, lock: ReservationProductsLock) => Promise<T>,
): Promise<T> {
  return runReservationTransaction(
    async (tx, owner) => work(tx, await lockReservationInTransaction(owner, scope)),
    { reservationId: scope.reservationId },
  );
}

/**
 * A change that locks the reservation alone (`lockReservationOnlyInTransaction`):
 * one that takes or gives back no stock and runs no check.
 */
export function runReservationOnlyChange<T>(
  scope: ReservationScope,
  work: (tx: Transaction, lock: ReservationOnlyLock) => Promise<T>,
): Promise<T> {
  return runReservationTransaction(
    async (tx, owner) => work(tx, await lockReservationOnlyInTransaction(owner, scope)),
    { reservationId: scope.reservationId },
  );
}

/** A plain read: at READ COMMITTED it sees the latest commit, and under the row's lock, the row as locked. */
async function readReservationStatus(
  tx: Transaction,
  scope: ReservationScope,
): Promise<ReservationStatus | null> {
  const [row] = await tx
    .select({ status: reservations.status })
    .from(reservations)
    .where(and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)));
  return row?.status ?? null;
}

/**
 * A change whose locks follow the reservation's status, for a caller that
 * moves stock from some statuses and not from others. It reads the status
 * plainly, then takes the products' lock (as `runReservationChange`) when
 * `needsProducts(status)`, else the reservation's alone (as
 * `runReservationOnlyChange`): a change that moves no stock takes no product
 * lock. `work` gets the status as read under the lock. When the reservation's
 * lock finds another status than the one read, the run starts over from the
 * read, within the owner entry's three runs. A reservation that does not exist
 * in the store gets the reservation-only lock and the status null.
 */
export function runReservationChangeByStatus<T>(
  scope: ReservationScope,
  needsProducts: (status: ReservationStatus) => boolean,
  work: (
    tx: Transaction,
    lock: ReservationStatusLock,
    status: ReservationStatus | null,
  ) => Promise<T>,
): Promise<T> {
  return runReservationTransaction(
    async (tx, owner) => {
      const read = await readReservationStatus(tx, scope);
      if (read !== null && needsProducts(read)) {
        const lock = await lockReservationInTransaction(owner, scope);
        return work(tx, lock, await readReservationStatus(tx, scope));
      }
      const lock = await lockReservationOnlyInTransaction(owner, scope);
      const locked = await readReservationStatus(tx, scope);
      if (locked !== read) throw new ReservationStatusChangedError(scope.reservationId);
      return work(tx, lock, locked);
    },
    { reservationId: scope.reservationId },
  );
}

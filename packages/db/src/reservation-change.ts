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
  type ReservationTransaction,
} from "./reservation-lock";

/** Most runs of an owner transaction: a lost deadlock or a product added starts it over. */
const RESERVATION_CHANGE_RUNS = 3;

/**
 * The owner transaction lost a deadlock, or saw the reservation's products
 * change, on each of its runs. Nothing was written. Each caller answers it
 * its own way: the store's procedures with `RESERVATION_BUSY`, the
 * customer's actions with their retryable error, the payment's confirmation
 * by throwing (the webhook answers non-2xx and Stripe redelivers), a cron by
 * leaving the reservation for its next run.
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

const startsOver = (error: unknown) =>
  isDatabaseDeadlock(error) || isReservationProductsChangedError(error);

/**
 * The owner entry: opens a READ COMMITTED transaction, whatever the
 * session's default, and runs `work` in it with the owner token that the
 * lock entries take. A lost deadlock, or `ReservationProductsChangedError`
 * from a lock, rolls the transaction back and runs the whole of it again,
 * three runs in all; then it throws `ReservationChangeBusyError`.
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

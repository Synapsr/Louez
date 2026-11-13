import {
  changeReservationStatus,
  consumeReservationStock,
  payments,
  reservations,
  runReservationChangeByStatus,
  runReservationOnlyChange,
  type ReservationBillingEffect,
  type ReservationEffectRunner,
  type Transaction,
} from "@louez/db";
import { and, eq, inArray } from "drizzle-orm";

import { paidConfirmationKeepsDeposit } from "./paid-confirmation-deposit";
import { checkExistingReservationInventory } from "./reservation-inventory";

/**
 * The paid confirmation: a paid pending reservation confirmed as the
 * `payment` actor (docs/domain/reservation-changes.md, slice 6a-3). The paid
 * checkout's completion in the app claims the payment, validates the
 * contract, confirms a marketplace attempt and writes the payment's row and
 * messages before it, and sends the confirmation's messages after it: they
 * live in the app.
 *
 * Two commits, as before the move: the payment details under the
 * reservation's lock alone, then the status transaction, which locks the
 * reservation's products first when it is `pending` or `confirmed`
 * (`runReservationChangeByStatus`, DL-12). Both decide the deposit from the
 * hold ledger read after the reservation's lock (slice 6a-1).
 */

/** What the paid confirmation writes of the deposit when no funds are held or were taken. */
export type PaidConfirmationDepositStatus = "none" | "card_saved" | "pending";

export interface PaidConfirmationInput {
  reservationId: string;
  storeId: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  depositStatus: PaidConfirmationDepositStatus;
  /** The metadata of the `confirmed` activity row. */
  activityMetadata: Record<string, unknown>;
}

/**
 * Whether one of the reservation's `deposit_hold` rows holds funds (`authorized`, a
 * release owed included) or took them (`completed`): `readHoldRows`' filter narrowed
 * to those statuses, served by `payments_reservation_idx`. Read under the
 * reservation's row lock, which every writer of a hold row takes first: it is what
 * the hold writer last committed.
 */
const depositLedgerHoldsFunds = async (tx: Transaction, reservationId: string) => {
  const [row] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.type, "deposit_hold"),
        inArray(payments.status, ["authorized", "completed"]),
      ),
    )
    .limit(1);
  return row !== undefined;
};

/**
 * The reservation's status and deposit as stored, read after its row lock, and
 * whether the paid confirmation leaves the deposit as it is
 * (`paidConfirmationKeepsDeposit`). Null when the reservation is not in the store.
 */
const readDepositUnderLock = async (
  tx: Transaction,
  scope: { reservationId: string; storeId: string },
) => {
  const [row] = await tx
    .select({ status: reservations.status, depositStatus: reservations.depositStatus })
    .from(reservations)
    .where(and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)));
  if (!row) return null;
  const keeps = paidConfirmationKeepsDeposit({
    depositStatus: row.depositStatus,
    ledgerHoldsFunds: await depositLedgerHoldsFunds(tx, scope.reservationId),
  });
  return { ...row, keeps };
};

/**
 * Confirms a paid pending reservation as the `payment` actor, with its
 * `confirmed` activity row, then runs the fee effects. Returns false when it
 * was not pending. A refusal of the stock check throws
 * `ReservationInventoryError` or `ConsumableStockError`, which the caller
 * logs. A reservation still busy after the owner entry's runs throws
 * `ReservationChangeBusyError`: the webhook answers non-2xx and Stripe sends
 * the event again; the payment's claim, committed before, stays.
 *
 * The session's customer, card and `depositStatus` are written on a pending
 * reservation unless funds are held or were taken on it: then its deposit is left
 * as stored, and the `confirmed` row says so (`depositStatusKept`).
 */
export async function confirmPaidReservation(
  input: PaidConfirmationInput,
  runReservationEffects: ReservationEffectRunner,
): Promise<boolean> {
  const scope = { reservationId: input.reservationId, storeId: input.storeId };

  // Keep payment/deposit metadata even when stock consumption rolls back. A
  // merchant can then restock and confirm the paid reservation manually. Under
  // the reservation's lock alone, as the hold writer takes it, and committed
  // before the status transaction opens: it adds no lock order. The status
  // transaction decides again under its own lock, so a hold settled between the
  // two is seen there.
  await runReservationOnlyChange(scope, async (tx) => {
    const found = await readDepositUnderLock(tx, scope);
    if (found?.status !== "pending" || found.keeps) return;
    await tx
      .update(reservations)
      .set({
        stripeCustomerId: input.stripeCustomerId,
        stripePaymentMethodId: input.stripePaymentMethodId,
        depositStatus: input.depositStatus,
        updatedAt: new Date(),
      })
      .where(
        and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)),
      );
  });

  // A pending reservation is checked and takes its stock, a confirmed one is
  // repaired below: the owner entry locks their products, then the
  // reservation (DL-12). Any other status is left as it is, under the
  // reservation's lock alone. A lost deadlock, a product added or the status
  // changed meanwhile runs the whole transaction again. It records no
  // payment, so a new run cannot record one twice; the effects run once,
  // after it.
  const result = await runReservationChangeByStatus(
    scope,
    (status) => status === "pending" || status === "confirmed",
    async (tx, lock): Promise<{ confirmed: boolean; effects: ReservationBillingEffect[] }> => {
      // After the lock the owner entry took: the deposit and the ledger as the hold
      // writer last committed them, decided on with the status change.
      const found = await readDepositUnderLock(tx, scope);
      const change = await changeReservationStatus(tx, {
        lock,
        reservationId: input.reservationId,
        storeId: input.storeId,
        to: "confirmed",
        actor: "payment",
        actorUserId: null,
        expectedFrom: "pending",
        beforeWrite: (lockedTx) =>
          checkExistingReservationInventory(lockedTx, input.reservationId, input.storeId),
        activity: {
          metadata: {
            ...input.activityMetadata,
            ...(found?.keeps && { depositStatusKept: found.depositStatus }),
          },
        },
      });

      if (!change.changed) {
        // Already confirmed, by the other completion path or the merchant: make
        // sure its consumables were taken. Consuming twice changes nothing. Read
        // as confirmed under its lock, so the lock is the products'.
        if (change.from === "confirmed" && lock.kind === "products") {
          await consumeReservationStock(tx, lock);
        }
        return { confirmed: false, effects: [] };
      }

      if (!found?.keeps) {
        await tx
          .update(reservations)
          .set({
            stripeCustomerId: input.stripeCustomerId,
            stripePaymentMethodId: input.stripePaymentMethodId,
            depositStatus: input.depositStatus,
          })
          .where(
            and(eq(reservations.id, scope.reservationId), eq(reservations.storeId, scope.storeId)),
          );
      }

      return { confirmed: true, effects: change.effects };
    },
  );

  // The webhook records a paid checkout's fee itself, so this is empty today.
  await runReservationEffects(result.effects);
  return result.confirmed;
}

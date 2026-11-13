import {
  changeReservationStatus,
  db,
  payments,
  reservationActivity,
  reservationCalendarEvents,
  reservations,
  runReservationOnlyChange,
  toWholeSeconds,
  type ChangeReservationStatusResult,
  type ReservationEffectRunner,
} from "@louez/db";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * The system's status changes: a storefront checkout cancelled when its
 * payment window closed unpaid, or when its payment could not be started
 * (docs/domain/reservation-changes.md, slice 6a-4). Each locks the reservation
 * alone, since a pending checkout gives back no stock, changes it as the
 * `system` actor, then runs the fee effects through the runner it is given,
 * after the commit. Its callers (the Connect webhook, the checkout, the
 * cleanup script) keep what lives in the app.
 */

export type SystemReservationStatusRequest =
  | {
      /** The checkout's only payment window closed without a payment. */
      reason: "checkout_abandoned";
      reservationId: string;
      checkoutSessionId: string;
    }
  | {
      /** The checkout's payment could not be started. */
      reason: "checkout_failed";
      storeId: string;
      reservationId: string;
      failure: "amount_too_small" | "session_creation_failed";
      minimumAmount?: number;
      currency?: string;
      /** Left as it is unless the reservation's total is still this one. */
      expectedAmount?: string;
    };

/** Thrown under the lock to leave a checkout that can still be paid. */
class CheckoutStillPayableError extends Error {}

/**
 * A storefront checkout whose only payment window closed without a payment
 * is not a booking: the pending reservation is cancelled so it stops holding
 * stock and the owner does not keep a "payment in progress" that never ends.
 * Anything already confirmed, paid, or paid through another open session is
 * left alone. The fee effects run through `runReservationEffects` after commit.
 * It locks the reservation alone: a pending checkout gives back no stock. Still
 * busy after the owner entry's runs, it throws and the webhook answers non-2xx,
 * as a lost deadlock did before. Stripe sends the event again, but nothing runs
 * this cancellation again: the first delivery committed the session's payment
 * as cancelled, so the redelivery reads the checkout as not abandoned and skips
 * it, and the reservation stays pending (docs/domain/reservation-changes.md,
 * "Open, not in this lot").
 */
const cancelAbandonedCheckout = async (
  { reservationId, checkoutSessionId }: { reservationId: string; checkoutSessionId: string },
  runReservationEffects: ReservationEffectRunner,
): Promise<boolean> => {
  const reservation = await db.query.reservations.findFirst({
    columns: { storeId: true, status: true, source: true },
    where: eq(reservations.id, reservationId),
  });
  if (!reservation || reservation.status !== "pending" || reservation.source !== "online") {
    return false;
  }

  let change: ChangeReservationStatusResult;
  try {
    change = await runReservationOnlyChange(
      { reservationId, storeId: reservation.storeId },
      async (tx, lock) => {
        // Under the lock, with a locking read: a payment claimed or a session
        // opened since the read above is seen.
        const [payment] = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.reservationId, reservationId),
              eq(payments.type, "rental"),
              inArray(payments.status, ["pending", "completed"]),
            ),
          )
          .limit(1)
          .for("share");
        if (payment) throw new CheckoutStillPayableError();
        return changeReservationStatus(tx, {
          lock,
          reservationId,
          storeId: reservation.storeId,
          to: "cancelled",
          actor: "system",
          actorUserId: null,
          expectedFrom: "pending",
          activity: { metadata: { reason: "payment_expired", checkoutSessionId } },
        });
      },
    );
  } catch (error) {
    if (error instanceof CheckoutStillPayableError) return false;
    throw error;
  }
  if (!change.changed) return false;

  await runReservationEffects(change.effects);
  return true;
};

/**
 * Cancel only an unpaid online checkout; never override a payment or decision.
 * The fee effects run through `runReservationEffects` after commit. It locks
 * the reservation alone: a pending checkout gives back no stock. A
 * reservation still busy after the owner entry's runs throws
 * `ReservationChangeBusyError`, as a lost deadlock threw before: nothing runs
 * this cancellation again, so its caller answers the failure (the checkout
 * logs it and answers `errors.createReservationError`).
 */
const cancelFailedCheckout = async (
  {
    storeId,
    reservationId,
    failure: reason,
    minimumAmount,
    currency,
    expectedAmount,
  }: Extract<SystemReservationStatusRequest, { reason: "checkout_failed" }>,
  runReservationEffects: ReservationEffectRunner,
): Promise<boolean> => {
  const effects = await runReservationOnlyChange({ reservationId, storeId }, async (tx, lock) => {
    const [reservation] = await tx
      .select({
        id: reservations.id,
        status: reservations.status,
        source: reservations.source,
        totalAmount: reservations.totalAmount,
      })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
      .for("update");
    if (!reservation || reservation.status !== "pending" || reservation.source !== "online") {
      return null;
    }
    if (expectedAmount !== undefined && reservation.totalAmount !== expectedAmount) return null;
    const [payment] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reservationId, reservation.id))
      .limit(1);
    // Any payment row may point to a Stripe session the customer can still pay.
    if (payment) return null;

    // Whole seconds, as the status change stores its row: MySQL would round this
    // one up, and the timeline would show the cancellation first.
    const now = toWholeSeconds(new Date());
    const metadata = {
      source: "checkout_payment_failed",
      reason,
      ...(minimumAmount !== undefined ? { minimumAmount } : {}),
      ...(currency ? { currency } : {}),
    };
    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "payment_failed",
      metadata,
      createdAt: now,
    });
    const change = await changeReservationStatus(tx, {
      lock,
      reservationId,
      storeId,
      to: "cancelled",
      actor: "system",
      actorUserId: null,
      expectedFrom: "pending",
      activity: { metadata },
    });
    // The row is locked and pending, so only a bug lands here: roll back the payment_failed row.
    if (!change.changed) {
      throw new Error(`Could not cancel failed checkout ${reservationId}: ${change.reason}`);
    }
    // Existing calendar events must release the cancelled checkout too.
    await tx
      .update(reservationCalendarEvents)
      .set({
        syncStatus: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(reservationCalendarEvents.reservationId, reservationId));
    return change.effects;
  });
  if (!effects) return false;

  await runReservationEffects(effects);
  return true;
};

/**
 * Cancels a storefront checkout as the `system` actor, then runs its fee
 * effects. Returns whether it cancelled: a reservation outside the request's
 * conditions is left as it is. A reservation still busy after the owner entry's
 * runs throws `ReservationChangeBusyError`.
 */
export async function changeSystemReservationStatus(
  request: SystemReservationStatusRequest,
  runReservationEffects: ReservationEffectRunner,
): Promise<boolean> {
  return request.reason === "checkout_abandoned"
    ? cancelAbandonedCheckout(request, runReservationEffects)
    : cancelFailedCheckout(request, runReservationEffects);
}

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import {
  changeReservationStatus,
  toWholeSeconds,
  type ReservationEffectRunner,
} from "./reservation-status";
import { payments, reservationActivity, reservationCalendarEvents, reservations } from "./schema";

/**
 * Cancel only an unpaid online checkout; never override a payment or decision.
 * The fee effects run through `runReservationEffects` after commit.
 */
export const cancelFailedCheckoutReservation = async (
  {
    storeId,
    reservationId,
    reason,
    minimumAmount,
    currency,
    expectedAmount,
  }: {
    storeId: string;
    reservationId: string;
    reason: "amount_too_small" | "session_creation_failed";
    minimumAmount?: number;
    currency?: string;
    expectedAmount?: string;
  },
  runReservationEffects: ReservationEffectRunner,
): Promise<boolean> => {
  const effects = await db.transaction(async (tx) => {
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

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { payments, reservationActivity, reservationCalendarEvents, reservations } from "./schema";

/** Cancel only an unpaid online checkout; never override a payment or decision. */
export const cancelFailedCheckoutReservation = async ({
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
}): Promise<boolean> =>
  db.transaction(async (tx) => {
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
      return false;
    }
    if (expectedAmount !== undefined && reservation.totalAmount !== expectedAmount) return false;
    const [payment] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reservationId, reservation.id))
      .limit(1);
    // Any payment row may point to a Stripe session the customer can still pay.
    if (payment) return false;

    const now = new Date();
    const metadata = {
      source: "checkout_payment_failed",
      reason,
      ...(minimumAmount !== undefined ? { minimumAmount } : {}),
      ...(currency ? { currency } : {}),
    };
    await tx
      .update(reservations)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(reservations.id, reservation.id), eq(reservations.storeId, storeId)));
    await tx.insert(reservationActivity).values([
      { id: nanoid(), reservationId, activityType: "payment_failed", metadata, createdAt: now },
      { id: nanoid(), reservationId, activityType: "cancelled", metadata, createdAt: now },
    ]);
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
    return true;
  });

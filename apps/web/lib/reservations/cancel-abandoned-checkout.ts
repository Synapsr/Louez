import { and, eq, inArray } from "drizzle-orm";

import {
  changeReservationStatus,
  db,
  payments,
  reservations,
  type ChangeReservationStatusResult,
  type ReservationEffectRunner,
} from "@louez/db";

/** Thrown under the lock to leave a checkout that can still be paid. */
class CheckoutStillPayableError extends Error {}

/**
 * A storefront checkout whose only payment window closed without a payment
 * is not a booking: the pending reservation is cancelled so it stops holding
 * stock and the owner does not keep a "payment in progress" that never ends.
 * Anything already confirmed, paid, or paid through another open session is
 * left alone. The fee effects run through `runReservationEffects` after commit.
 */
export const cancelAbandonedCheckout = async (
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
    change = await db.transaction((tx) =>
      changeReservationStatus(tx, {
        reservationId,
        storeId: reservation.storeId,
        to: "cancelled",
        actor: "system",
        actorUserId: null,
        expectedFrom: "pending",
        // Under the lock, with a locking read: a payment claimed or a session
        // opened since the read above is seen.
        beforeWrite: async (lockedTx) => {
          const [payment] = await lockedTx
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
        },
        activity: { metadata: { reason: "payment_expired", checkoutSessionId } },
      }),
    );
  } catch (error) {
    if (error instanceof CheckoutStillPayableError) return false;
    throw error;
  }
  if (!change.changed) return false;

  await runReservationEffects(change.effects);
  return true;
};

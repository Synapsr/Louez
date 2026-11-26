import { and, eq } from "drizzle-orm";

import { payments, type Transaction, unsettledCheckoutSession } from "@louez/db";

import { enqueueEffects } from "../platform/effects";

/**
 * In the transaction of a write that lowers what the customer owes for the
 * rental (a payment recorded, the total lowered, the reservation cancelled or
 * rejected), under the reservation's lock: the expiry of the rental's Checkout
 * Sessions it leaves open (`payment.rentalSessionsExpiry`), whose charge was set
 * on the balance before it. Under that lock no session is installed meanwhile:
 * one opened afterwards charges the new balance. Nothing is added when none is
 * open. Returns the effects' ids, which the caller dispatches once committed.
 */
export async function enqueueRentalSessionsExpiry(
  tx: Transaction,
  storeId: string,
  reservationId: string,
): Promise<string[]> {
  const open = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), unsettledCheckoutSession));
  if (open.length === 0) return [];
  return enqueueEffects(tx, storeId, [
    {
      type: "payment.rentalSessionsExpiry",
      reservationId,
      payload: { reservationId, paymentIds: open.map((row) => row.id) },
    },
  ]);
}

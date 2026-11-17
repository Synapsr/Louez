import "server-only";

import { and, eq } from "drizzle-orm";

import { db, reservations } from "@louez/db";

import { getCustomerSession } from "./session";

/**
 * Whether this browser is signed in, on this store, as the customer the
 * reservation belongs to. Nothing else proves who holds a reservation's
 * link: paying it does not (the checkout e-mail is never verified).
 */
export const hasReservationCustomerSession = async (
  storeId: string,
  reservationId: string,
): Promise<boolean> => {
  const session = await getCustomerSession(storeId);
  if (!session) return false;

  const reservation = await db.query.reservations.findFirst({
    columns: { id: true },
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, storeId),
      eq(reservations.customerId, session.customerId),
    ),
  });
  return reservation !== undefined;
};

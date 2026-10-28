import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { payments, reservationActivity, reservations, type Transaction } from "@louez/db";

/** Called inside the transaction that confirms a reservation or records its payment. */
export const validateReservationContract = async (
  tx: Transaction,
  reservationId: string,
  storeId: string,
  source: "confirmation" | "payment" | "quote_acceptance",
): Promise<Date | null> => {
  const [reservation] = await tx
    .select({ status: reservations.status, signedAt: reservations.signedAt })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)))
    .for("update");
  if (
    !reservation ||
    reservation.signedAt ||
    ["cancelled", "rejected", "declined"].includes(reservation.status)
  )
    return null;
  if (!["confirmed", "ongoing", "completed"].includes(reservation.status)) {
    if (source !== "payment") return null;
    const [payment] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, reservationId),
          eq(payments.type, "rental"),
          eq(payments.status, "completed"),
          gt(payments.amount, "0"),
        ),
      )
      .limit(1);
    if (!payment) return null;
  }
  const validatedAt = new Date();
  await tx
    .update(reservations)
    .set({ signedAt: validatedAt, signatureIp: null, updatedAt: validatedAt })
    .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)));
  await tx.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: "modified",
    metadata: {
      kind: "automatic_contract_validation",
      source,
      validatedAt: validatedAt.toISOString(),
    },
  });
  return validatedAt;
};

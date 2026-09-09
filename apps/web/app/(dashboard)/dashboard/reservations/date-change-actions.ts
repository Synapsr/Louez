"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, reservations, reservationActivity } from "@louez/db";
import { getCurrentStore, hasPermission } from "@/lib/store-context";
import { dateChangeRequestSchema } from "@/lib/reservations/util.date-change-request";
import { log } from "@/lib/evlog";

export const rejectReturnDateChange = async (reservationId: string, requestId: string) => {
  if (
    !z.string().length(21).safeParse(reservationId).success ||
    !z.string().length(21).safeParse(requestId).success
  )
    return { error: true };
  const store = await getCurrentStore();
  if (!store || !hasPermission(store.role, "write")) return { error: true };
  try {
    const result = await db.transaction(async (tx) => {
      const [reservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)))
        .for("update");
      if (!reservation) return { error: true };
      const [row] = await tx
        .select({ metadata: reservationActivity.metadata })
        .from(reservationActivity)
        .where(
          and(
            eq(reservationActivity.id, requestId),
            eq(reservationActivity.reservationId, reservationId),
          ),
        );
      const request = dateChangeRequestSchema.safeParse(row?.metadata);
      if (!request.success || request.data.status !== "pending") return { error: true };
      await tx
        .update(reservationActivity)
        .set({
          metadata: { ...request.data, status: "rejected", reviewedAt: new Date().toISOString() },
        })
        .where(
          and(
            eq(reservationActivity.id, requestId),
            eq(reservationActivity.reservationId, reservationId),
          ),
        );
      return { success: true };
    });
    revalidatePath("/dashboard/reservations");
    revalidatePath(`/dashboard/reservations/${reservationId}`);
    revalidatePath(`/${store.slug}/account`);
    return result;
  } catch (error) {
    log.error(
      "reservation.date-change-rejection.failed",
      `Reservation ${reservationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { error: true };
  }
};

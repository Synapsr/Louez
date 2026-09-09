"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, reservations, reservationActivity, stores } from "@louez/db";
import { getCustomerSession } from "@/lib/customer-auth/session";
import {
  canRequestDateChange,
  getDateChangeRequests,
  isValidRequestedEndDate,
} from "@/lib/reservations/util.date-change-request";
import { log } from "@/lib/evlog";

const inputSchema = z.object({
  storeSlug: z.string().min(1).max(255),
  reservationId: z.string().length(21),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  reason: z.string().trim().max(1000),
});

export const requestReturnDateChange = async (input: z.infer<typeof inputSchema>) => {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidData" };
  const data = parsed.data;
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, data.storeSlug),
    columns: { id: true, settings: true },
  });
  if (!store) return { error: "unauthorized" };
  const session = await getCustomerSession(store.id);
  if (!session) return { error: "unauthorized" };
  const timezone = store.settings?.timezone ?? "UTC";
  const endDate = fromZonedTime(data.endDate, timezone);
  if (
    !Number.isFinite(endDate.getTime()) ||
    formatInTimeZone(endDate, timezone, "yyyy-MM-dd'T'HH:mm") !== data.endDate
  )
    return { error: "invalidData" };
  try {
    const result = await db.transaction(async (tx) => {
      const [reservation] = await tx
        .select({
          id: reservations.id,
          status: reservations.status,
          startDate: reservations.startDate,
          endDate: reservations.endDate,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.id, data.reservationId),
            eq(reservations.storeId, store.id),
            eq(reservations.customerId, session.customerId),
          ),
        )
        .for("update");
      if (!reservation) return { error: "reservationNotFound" };
      if (
        !canRequestDateChange(reservation.status) ||
        !isValidRequestedEndDate(endDate, reservation.startDate, reservation.endDate, new Date())
      )
        return { error: "invalidData" };
      const activity = await tx
        .select({ id: reservationActivity.id, metadata: reservationActivity.metadata })
        .from(reservationActivity)
        .where(eq(reservationActivity.reservationId, reservation.id))
        .orderBy(desc(reservationActivity.createdAt));
      if (getDateChangeRequests(activity).some((request) => request.status === "pending"))
        return { error: "invalidData" };
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId: reservation.id,
        activityType: "note_updated",
        metadata: {
          kind: "return_date_request",
          status: "pending",
          originalStartDate: reservation.startDate.toISOString(),
          originalEndDate: reservation.endDate.toISOString(),
          requestedEndDate: endDate.toISOString(),
          reason: data.reason,
        },
      });
      return { success: true };
    });
    revalidatePath(`/${data.storeSlug}/account`);
    revalidatePath("/dashboard/reservations");
    revalidatePath(`/dashboard/reservations/${data.reservationId}`);
    return result;
  } catch (error) {
    log.error(
      "reservation.date-change-request.failed",
      `Reservation ${data.reservationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { error: "invalidData" };
  }
};

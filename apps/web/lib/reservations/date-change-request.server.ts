import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { reservationActivity, type Transaction } from "@louez/db";
import {
  canRequestDateChange,
  getDateChangeRequests,
  getDateChangeResolution,
} from "@/lib/reservations/util.date-change-request";

export const resolveDateChangeRequests = async (
  tx: Transaction,
  reservationId: string,
  startDate: Date,
  endDate: Date,
  reservationStatus: string,
): Promise<void> => {
  const rows = await tx
    .select({ id: reservationActivity.id, metadata: reservationActivity.metadata })
    .from(reservationActivity)
    .where(eq(reservationActivity.reservationId, reservationId))
    .orderBy(desc(reservationActivity.createdAt));
  for (const request of getDateChangeRequests(rows).filter(
    (request) => request.status === "pending",
  )) {
    const status = canRequestDateChange(reservationStatus)
      ? getDateChangeResolution(request, startDate, endDate)
      : "superseded";
    if (status === "pending") continue;
    const { id, ...metadata } = request;
    await tx
      .update(reservationActivity)
      .set({
        metadata: {
          ...metadata,
          status,
          reviewedAt: new Date().toISOString(),
        },
      })
      .where(
        and(eq(reservationActivity.id, id), eq(reservationActivity.reservationId, reservationId)),
      );
  }
};

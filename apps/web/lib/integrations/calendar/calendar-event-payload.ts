import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { db, reservations } from "@louez/db";

import type { GoogleCalendarEventInput } from "@/lib/integrations/providers/google-calendar/google-calendar-client";

import { env } from "@/env";

import {
  buildReservationCalendarEventDetails,
  getCalendarReservationStatusLabel,
  getCalendarRoomNames,
} from "./reservation-event-details";

// Google Calendar only accepts palette IDs, so these approximate Louez status colors.
const GOOGLE_CALENDAR_COLOR_BY_STATUS: Record<string, string> = {
  pending: "5",
  confirmed: "10",
  ongoing: "9",
  completed: "8",
  cancelled: "6",
  rejected: "11",
  quote: "3",
  declined: "4",
};

function isCancelledStatus(status: string): boolean {
  return status === "cancelled" || status === "rejected" || status === "declined";
}

export async function buildReservationCalendarEventPayload(params: {
  reservationId: string;
  syncPendingReservations: boolean;
  cancelledReservationBehavior: "show" | "hide";
}): Promise<{
  event: GoogleCalendarEventInput | null;
  payloadHash: string;
  shouldDelete: boolean;
}> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, params.reservationId),
    with: {
      customer: true,
      items: {
        with: {
          product: {
            with: {
              category: true,
              categoryLinks: {
                with: {
                  category: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!reservation) {
    throw new Error("Reservation not found");
  }

  const cancelled = isCancelledStatus(reservation.status);
  const shouldDelete =
    (cancelled && params.cancelledReservationBehavior === "hide") ||
    (reservation.status === "pending" && !params.syncPendingReservations);

  const getItemName = (item: (typeof reservation.items)[number]) =>
    item.productSnapshot?.name || item.product?.name || "Unknown";
  const formatItemName = (name: string, quantity: number) =>
    quantity > 1 ? `${name} (x${quantity})` : name;
  const productNames = reservation.items.map((item) =>
    formatItemName(getItemName(item), item.quantity),
  );
  const roomNames = getCalendarRoomNames(
    reservation.items.map((item) => ({
      name: getItemName(item),
      quantity: item.quantity,
      category: item.product?.category,
      categories: item.product?.categoryLinks.map((link) => link.category),
    })),
  );

  const reservationUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservation.id}`;
  const eventDetails = buildReservationCalendarEventDetails({
    reservation,
    productNames,
    roomNames,
    statusLabel: getCalendarReservationStatusLabel(reservation.status),
    reservationUrl,
  });

  const event: GoogleCalendarEventInput = {
    ...eventDetails,
    status:
      reservation.status === "pending" || reservation.status === "quote"
        ? "tentative"
        : "confirmed",
    transparency: "transparent",
    visibility: "private",
    colorId: GOOGLE_CALENDAR_COLOR_BY_STATUS[reservation.status] ?? "8",
    url: reservationUrl,
  };
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ event, shouldDelete }))
    .digest("hex");

  return {
    event: shouldDelete ? null : event,
    payloadHash,
    shouldDelete,
  };
}

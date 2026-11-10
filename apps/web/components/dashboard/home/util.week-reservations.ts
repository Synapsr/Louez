import type { ReservationCalendarPeriodEntry } from "@louez/validations";

import type { HomeReservation } from "./home-types";

/** Days of the home's week calendar. */
export const WEEK_DAYS = 7;
/** How far past the week a quiet day looks for what comes next. */
export const NEXT_ACTIVITY_HORIZON_DAYS = 28;

export interface WeekReservation extends HomeReservation {
  status: string | null;
}

/**
 * The reservations calendar's 28-day chunks, read as the home's rows: each
 * reservation once, even when it spans two chunks.
 */
export const toWeekReservations = (
  chunks: Array<ReservationCalendarPeriodEntry[] | undefined>,
): WeekReservation[] => {
  const byId = new Map<string, WeekReservation>();
  for (const chunk of chunks) {
    for (const entry of chunk ?? []) {
      if (byId.has(entry.id)) continue;
      byId.set(entry.id, {
        id: entry.id,
        number: entry.number,
        status: entry.status,
        startDate: entry.startDate,
        endDate: entry.endDate,
        totalAmount: entry.totalAmount,
        customer: {
          firstName: entry.customer?.firstName ?? "",
          lastName: entry.customer?.lastName ?? "",
        },
        items: entry.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          product: {
            name: item.product?.name ?? item.productSnapshot?.name ?? "",
            images: item.product?.images ?? item.productSnapshot?.images ?? null,
          },
        })),
      });
    }
  }
  return [...byId.values()];
};

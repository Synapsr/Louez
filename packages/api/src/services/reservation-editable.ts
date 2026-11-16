import type { ReservationStatus } from "@louez/db";

/**
 * The statuses whose reservation may be edited (docs/domain/reservation-changes.md,
 * slice 8a; T3): its lines, its dates, its totals. The others are what was
 * rented (`completed`) or what was refused (`cancelled`, `rejected`,
 * `declined`). One rule for every editor: the dashboard's edit and its edit
 * page, and the date change of the API and agents. Each reads it before its
 * lock and again under it.
 *
 * Pure, with no runtime import: the dashboard's client components read it too.
 */
export const EDITABLE_RESERVATION_STATUSES = [
  "pending",
  "quote",
  "confirmed",
  "ongoing",
] as const satisfies readonly ReservationStatus[];

export const isReservationEditable = (status: ReservationStatus): boolean =>
  (EDITABLE_RESERVATION_STATUSES as readonly ReservationStatus[]).includes(status);

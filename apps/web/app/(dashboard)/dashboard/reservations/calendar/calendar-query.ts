// Imported from `nuqs/server`: this module is also pulled into the reservations
// page (a server component), and the client entry point is marked "use client".
import { createParser } from "nuqs/server";

export const RESERVATION_VIEWS = ["list", "calendar", "planning"] as const;
export type ReservationView = (typeof RESERVATION_VIEWS)[number];

export const TODAY_OPERATIONS = ["departure", "return"] as const;
export type TodayOperation = (typeof TODAY_OPERATIONS)[number];

export const CALENDAR_RANGES = ["week", "twoWeeks", "month"] as const;
export type CalendarRange = (typeof CALENDAR_RANGES)[number];

export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "quote",
  "cancelled",
  "rejected",
  "declined",
] as const;
export type ReservationStatusFilter = (typeof RESERVATION_STATUSES)[number];

/** Terminal/negative statuses hidden by default to reduce noise */
const DEFAULT_HIDDEN_STATUSES = new Set(["cancelled", "rejected", "declined"]);
export const DEFAULT_VISIBLE_STATUSES = RESERVATION_STATUSES.filter(
  (status) => !DEFAULT_HIDDEN_STATUSES.has(status),
);

export function parseReservationView(value: string | undefined): ReservationView {
  if (value === "list" || value === "calendar" || value === "planning") return value;
  // Legacy values: `products` from the old calendar page, `cards`/`table`
  // from the old reservations view toggle.
  if (value === "products") return "planning";
  if (value === "cards" || value === "table") return "list";
  return "calendar";
}

export function matchesTodayOperation(
  reservation: { startDate: Date; endDate: Date },
  operation: TodayOperation | null,
  today = new Date(),
): boolean {
  if (!operation) return true;

  const date = operation === "departure" ? reservation.startDate : reservation.endDate;
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

/** The `twoWeeks` range only exists in the planning (Gantt) view. */
export function resolveCalendarRange(
  view: Exclude<ReservationView, "list">,
  range: CalendarRange,
): CalendarRange {
  if (view === "calendar" && range === "twoWeeks") return "week";
  return range;
}

export function toCalendarDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function parseCalendarDateParam(value: string | undefined): Date | null {
  if (value === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

/**
 * The `date` search param, as nuqs sees it: the day both timeline views centre
 * their viewport on. Keeping it in a parser lets the timelines read and write it
 * with the same `useQueryState` machinery as the other timeline filters.
 */
export const calendarDateParser = createParser({
  parse: (value: string) => parseCalendarDateParam(value),
  serialize: toCalendarDateParam,
  // Dates are compared by value. Without this, two `Date` objects for the same
  // day would look different to nuqs and could drive an update loop.
  eq: (a: Date, b: Date) => a.getTime() === b.getTime(),
});

import { formatInTimeZone } from "date-fns-tz";

/** The reservations calendar opened on one day of the store's calendar. */
export const getCalendarDayHref = (date: Date, timezone: string): string =>
  `/dashboard/reservations?view=calendar&date=${formatInTimeZone(date, timezone, "yyyy-MM-dd")}`;

export const TODAY_CALENDAR_HREF = "/dashboard/reservations?view=calendar&date=today";

/**
 * The reservations list on what is late: gear not back, hand-overs not done,
 * or both when no kind is given.
 */
export const getOverdueListHref = (kind?: "return" | "departure"): string =>
  `/dashboard/reservations?period=overdue${kind ? `&operation=${kind}` : ""}&sort=startDate&sortDirection=asc&source=${
    kind === "departure" ? "home_departure" : "home_return"
  }`;

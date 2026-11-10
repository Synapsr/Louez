import { addDays, differenceInCalendarDays, startOfDay, startOfMonth, subMonths } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/** Same fallback as the rest of the store's date logic (exports, sales, extensions). */
const FALLBACK_TIMEZONE = "UTC";

export type TimeOfDay = "morning" | "afternoon" | "evening";

/**
 * The store's day, read on its own clock: "today", "this month" and the
 * greeting follow the store's timezone, never the server's.
 */
export interface StoreDay {
  timezone: string;
  now: Date;
  todayStart: Date;
  tomorrowStart: Date;
  monthStart: Date;
  previousMonthStart: Date;
  /** The same moment one month earlier: where the month-to-date comparison stops. */
  previousMonthNow: Date;
  timeOfDay: TimeOfDay;
}

export const resolveStoreTimezone = (timezone: string | null | undefined): string => {
  const candidate = timezone?.trim();
  if (!candidate) return FALLBACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return FALLBACK_TIMEZONE;
  }
};

const getTimeOfDay = (hour: number): TimeOfDay => {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
};

export const getStoreDay = (now: Date, timezone: string | null | undefined): StoreDay => {
  const resolved = resolveStoreTimezone(timezone);
  const local = toZonedTime(now, resolved);
  const localToday = startOfDay(local);
  const localMonth = startOfMonth(local);

  return {
    timezone: resolved,
    now,
    todayStart: fromZonedTime(localToday, resolved),
    tomorrowStart: fromZonedTime(addDays(localToday, 1), resolved),
    monthStart: fromZonedTime(localMonth, resolved),
    previousMonthStart: fromZonedTime(subMonths(localMonth, 1), resolved),
    // date-fns clamps the 31st to the last day of a shorter month.
    previousMonthNow: fromZonedTime(subMonths(local, 1), resolved),
    timeOfDay: getTimeOfDay(local.getHours()),
  };
};

/** Midnight of the day `offset` days after the store's today. */
export const getStoreDayStart = (day: StoreDay, offset: number): Date =>
  fromZonedTime(addDays(startOfDay(toZonedTime(day.now, day.timezone)), offset), day.timezone);

/** Calendar days from the store's today to `date`: 0 today, 1 tomorrow, -1 yesterday. */
export const getStoreDayOffset = (day: StoreDay, date: Date): number =>
  differenceInCalendarDays(toZonedTime(date, day.timezone), toZonedTime(day.now, day.timezone));

/** Midnight of the day `days` after the one `date` falls on, on the store's clock. */
export const addStoreDays = (date: Date, days: number, timezone: string): Date =>
  fromZonedTime(addDays(startOfDay(toZonedTime(date, timezone)), days), timezone);

/** "2026-11-10": the store-calendar day a moment falls on, as a stable key. */
export const storeDayKey = (date: Date, timezone: string): string =>
  formatInTimeZone(date, timezone, "yyyy-MM-dd");

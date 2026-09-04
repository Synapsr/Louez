import { format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const UTC_TIMEZONE = "UTC";
const MAX_EXPORT_RANGE_DAYS = 365;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function resolveTimezone(timezone: string | null | undefined): string {
  const candidate = timezone?.trim();
  if (!candidate) return UTC_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return UTC_TIMEZONE;
  }
}

function dateOnlyToEpochDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_IN_MS;
}

export function isValidExportDateRange(startDate: string, endDate: string): boolean {
  return dateOnlyToEpochDay(endDate) >= dateOnlyToEpochDay(startDate);
}

export function isExportDateRangeWithinLimit(startDate: string, endDate: string): boolean {
  return dateOnlyToEpochDay(endDate) - dateOnlyToEpochDay(startDate) <= MAX_EXPORT_RANGE_DAYS;
}

export function resolveStoreExportDateRange(
  startDate: string,
  endDate: string,
  timezone: string | null | undefined,
): { startDate: Date; endDate: Date } {
  const resolvedTimezone = resolveTimezone(timezone);

  return {
    startDate: fromZonedTime(`${startDate}T00:00:00.000`, resolvedTimezone),
    endDate: fromZonedTime(`${endDate}T23:59:59.999`, resolvedTimezone),
  };
}

export function formatExportCalendarDate(date: Date, timezone: string | null | undefined): string {
  const candidate = timezone?.trim();
  if (!candidate) return format(date, "yyyy-MM-dd");

  try {
    return formatInTimeZone(date, candidate, "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(date, UTC_TIMEZONE, "yyyy-MM-dd");
  }
}

import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { BusinessHours, TimeRange } from "@louez/types";

import { getDaySchedule, isInClosurePeriod } from "@/lib/utils/business-hours";

export type StoreClosedReason = "closed_today" | "closure_period" | "outside_hours" | "break";

export interface StoreNextOpening {
  /** Days after `now` in the store calendar: 0 = today, 1 = tomorrow. */
  dayOffset: number;
  /** The instant used for that day, so the weekday can be formatted in the store timezone. */
  dayIso: string;
  /** "HH:mm" in the store timezone. */
  time: string;
}

/** Serializable, so the server can compute the first render and the client take over. */
export interface StoreStatus {
  isOpen: boolean;
  /** "HH:mm" when open. */
  closesAt: string | null;
  nextOpening: StoreNextOpening | null;
  reason: StoreClosedReason | null;
}

const LOOKAHEAD_DAYS = 14;

const toStoreTime = (date: Date, timezone?: string): string =>
  timezone ? formatInTimeZone(date, timezone, "HH:mm") : format(date, "HH:mm");

/** The range containing `time`; closing time is exclusive, a store closing at 18:00 is closed at 18:00. */
const findCurrentRange = (time: string, ranges: TimeRange[]): TimeRange | null =>
  ranges.find((range) => time >= range.openTime && time < range.closeTime) ?? null;

const findNextRangeToday = (time: string, ranges: TimeRange[]): TimeRange | null =>
  ranges.find((range) => range.openTime > time) ?? null;

const findNextOpening = (
  now: Date,
  businessHours: BusinessHours,
  timezone?: string,
): StoreNextOpening | null => {
  const currentTime = toStoreTime(now, timezone);

  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const day = offset === 0 ? now : addDays(now, offset);
    const closure = isInClosurePeriod(day, businessHours.closurePeriods, timezone);
    if (closure && !closure.startTime && !closure.endTime) continue;

    const schedule = getDaySchedule(day, businessHours, timezone);
    if (!schedule.isOpen || schedule.ranges.length === 0) continue;

    if (offset === 0) {
      const nextRange = findNextRangeToday(currentTime, schedule.ranges);
      if (nextRange) return { dayOffset: 0, dayIso: day.toISOString(), time: nextRange.openTime };
      continue;
    }

    return { dayOffset: offset, dayIso: day.toISOString(), time: schedule.ranges[0].openTime };
  }

  return null;
};

/**
 * Open or closed right now, and when that changes. Returns `null` when the
 * store has not configured opening hours (nothing to say). Pure over `now`
 * so the server can compute the badge's first render.
 */
export const getStoreStatus = (
  businessHours: BusinessHours | undefined,
  timezone?: string,
  now: Date = new Date(),
): StoreStatus | null => {
  if (!businessHours?.enabled) return null;

  const closure = isInClosurePeriod(now, businessHours.closurePeriods, timezone);
  if (closure) {
    const nextOpening = closure.endTime
      ? { dayOffset: 0, dayIso: now.toISOString(), time: closure.endTime }
      : findNextOpening(now, businessHours, timezone);
    return { isOpen: false, closesAt: null, nextOpening, reason: "closure_period" };
  }

  const schedule = getDaySchedule(now, businessHours, timezone);
  const currentTime = toStoreTime(now, timezone);

  if (!schedule.isOpen || schedule.ranges.length === 0) {
    return {
      isOpen: false,
      closesAt: null,
      nextOpening: findNextOpening(now, businessHours, timezone),
      reason: "closed_today",
    };
  }

  const firstRange = schedule.ranges[0];
  const lastRange = schedule.ranges[schedule.ranges.length - 1];

  if (currentTime < firstRange.openTime) {
    return {
      isOpen: false,
      closesAt: null,
      nextOpening: { dayOffset: 0, dayIso: now.toISOString(), time: firstRange.openTime },
      reason: "outside_hours",
    };
  }

  if (currentTime >= lastRange.closeTime) {
    return {
      isOpen: false,
      closesAt: null,
      nextOpening: findNextOpening(now, businessHours, timezone),
      reason: "outside_hours",
    };
  }

  const currentRange = findCurrentRange(currentTime, schedule.ranges);
  if (currentRange) {
    return { isOpen: true, closesAt: currentRange.closeTime, nextOpening: null, reason: null };
  }

  const nextRange = findNextRangeToday(currentTime, schedule.ranges);
  return {
    isOpen: false,
    closesAt: null,
    nextOpening: nextRange
      ? { dayOffset: 0, dayIso: now.toISOString(), time: nextRange.openTime }
      : findNextOpening(now, businessHours, timezone),
    reason: nextRange ? "break" : "outside_hours",
  };
};

/** "18:00" → "18:00" (fr), "6:00 PM" (en-US): a store clock time in the visitor's format. */
export const formatStoreClockTime = (time: string, locale: string): string => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes));

  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
};

/** Weekday name of an opening day, in the store timezone. */
export const formatStoreWeekday = (dayIso: string, locale: string, timezone?: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: timezone }).format(new Date(dayIso));

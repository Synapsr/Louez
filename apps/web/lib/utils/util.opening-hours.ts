import type { BusinessHours, ClosurePeriod, DaySchedule, TimeRange } from "@louez/types";

import { formatStoreClockTime } from "@/lib/utils/util.store-status";

/** Monday first, the way an opening-hours table reads in Europe. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
type DayIndex = (typeof WEEK_ORDER)[number];

const SCHEMA_DAYS: Record<DayIndex, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

export interface OpeningHoursRow {
  /** "lundi" or "lundi – vendredi" when consecutive days share the same hours. */
  days: string;
  /** Formatted ranges, one entry per range; empty when closed. */
  ranges: string[];
  isOpen: boolean;
}

export interface OpeningHoursSpecification {
  "@type": "OpeningHoursSpecification";
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

export interface UpcomingClosure {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

const scheduleKey = (schedule: DaySchedule): string =>
  schedule.isOpen
    ? schedule.ranges.map((range) => `${range.openTime}-${range.closeTime}`).join(",")
    : "closed";

const weekdayName = (day: DayIndex, locale: string): string =>
  // 2024-01-07 is a Sunday; adding the index lands on the wanted weekday.
  new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 7 + day)),
  );

const formatRange = (range: TimeRange, locale: string): string =>
  `${formatStoreClockTime(range.openTime, locale)} – ${formatStoreClockTime(range.closeTime, locale)}`;

/**
 * Opening hours as table rows, Monday to Sunday, consecutive days with the
 * same hours folded into one row ("lundi – vendredi"). Empty when hours are
 * not configured.
 */
export const buildOpeningHoursRows = (
  businessHours: BusinessHours | undefined,
  locale: string,
): OpeningHoursRow[] => {
  if (!businessHours?.enabled) return [];

  const groups: { from: DayIndex; to: DayIndex; schedule: DaySchedule }[] = [];
  for (const day of WEEK_ORDER) {
    const schedule = businessHours.schedule[day];
    const last = groups[groups.length - 1];
    if (last && scheduleKey(last.schedule) === scheduleKey(schedule)) {
      last.to = day;
    } else {
      groups.push({ from: day, to: day, schedule });
    }
  }

  return groups.map(({ from, to, schedule }) => ({
    days:
      from === to
        ? weekdayName(from, locale)
        : `${weekdayName(from, locale)} – ${weekdayName(to, locale)}`,
    ranges: schedule.isOpen ? schedule.ranges.map((range) => formatRange(range, locale)) : [],
    isOpen: schedule.isOpen,
  }));
};

/** schema.org `openingHoursSpecification` entries, one per (days, range). */
export const buildOpeningHoursSpecification = (
  businessHours: BusinessHours | undefined,
): OpeningHoursSpecification[] => {
  if (!businessHours?.enabled) return [];

  const byRange = new Map<string, { days: string[]; range: TimeRange }>();
  for (const day of WEEK_ORDER) {
    const schedule = businessHours.schedule[day];
    if (!schedule.isOpen) continue;
    for (const range of schedule.ranges) {
      const key = `${range.openTime}-${range.closeTime}`;
      const entry = byRange.get(key) ?? { days: [], range };
      entry.days.push(SCHEMA_DAYS[day]);
      byRange.set(key, entry);
    }
  }

  return [...byRange.values()].map(({ days, range }) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: days,
    opens: range.openTime,
    closes: range.closeTime,
  }));
};

/** Closure periods that are not over yet, soonest first. */
export const getUpcomingClosures = (
  closurePeriods: ClosurePeriod[] | undefined,
  now: Date = new Date(),
): UpcomingClosure[] => {
  const today = now.toISOString().slice(0, 10);
  return (closurePeriods ?? [])
    .filter((period) => period.endDate.slice(0, 10) >= today)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map(({ id, name, startDate, endDate }) => ({ id, name, startDate, endDate }));
};

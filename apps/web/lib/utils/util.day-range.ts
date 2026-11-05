// eslint-disable-next-line no-restricted-imports
import { format, type Locale } from "date-fns";

/**
 * Calendar days as `yyyy-MM-dd` strings: what a day picker hands to the URL and
 * to the server, which turns them into instants in the store's timezone. A day
 * has no timezone of its own, so none of this goes through `Date` arithmetic.
 */
export interface DayRange {
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day as a local midnight, the shape `react-day-picker` works in. */
export const dayToDate = (day: string): Date => {
  const match = DAY_PATTERN.exec(day);
  if (!match) return new Date(Number.NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

/** The local calendar day of a date picked in a calendar. */
export const dateToDay = (date: Date): string => format(date, "yyyy-MM-dd");

export const isDay = (value: string | null | undefined): value is string =>
  typeof value === "string" && DAY_PATTERN.test(value) && dateToDay(dayToDate(value)) === value;

/** Inclusive length of a range, in days. */
export const countRangeDays = ({ from, to }: DayRange): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Second click of a range selection: the two days in order, whichever was
 * picked first.
 */
export const orderDayRange = (first: string, second: string): DayRange =>
  second < first ? { from: second, to: first } : { from: first, to: second };

/**
 * "18 sept." for a single day, "1 sept. → 18 sept." for a range. The year only
 * shows when a bound leaves the current one.
 */
export const formatDayRange = (range: DayRange, locale: Locale, today: string): string => {
  const currentYear = today.slice(0, 4);
  const showYear = range.from.slice(0, 4) !== currentYear || range.to.slice(0, 4) !== currentYear;
  const pattern = showYear ? "d MMM yyyy" : "d MMM";
  const formatDay = (day: string) => format(dayToDate(day), pattern, { locale });

  return range.from === range.to
    ? formatDay(range.from)
    : `${formatDay(range.from)} → ${formatDay(range.to)}`;
};

/** A day shifted by whole days, on the calendar rather than on the clock. */
export const shiftDay = (day: string, amount: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);

interface SelectableDayBoundsInput {
  /** First day of a selection in progress. */
  anchor: string | null;
  minDay?: string;
  maxDay?: string;
  /** Longest range allowed, in days. */
  maxDays?: number;
}

/**
 * The days a range picker leaves open: the fixed bounds, tightened around the
 * first picked day so the second click can never exceed the longest range.
 */
export const getSelectableDayBounds = ({
  anchor,
  minDay,
  maxDay,
  maxDays,
}: SelectableDayBoundsInput): { earliest?: string; latest?: string } => {
  const reach = anchor !== null && maxDays ? maxDays - 1 : null;
  const lower = [minDay, anchor !== null && reach !== null ? shiftDay(anchor, -reach) : undefined];
  const upper = [maxDay, anchor !== null && reach !== null ? shiftDay(anchor, reach) : undefined];
  const isDefined = (day: string | undefined): day is string => day !== undefined;

  return {
    earliest: lower.filter(isDefined).sort().at(-1),
    latest: upper.filter(isDefined).sort().at(0),
  };
};

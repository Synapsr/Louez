import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Period of the Finances screen. A till is closed on calendar days, so every
 * bound is a `yyyy-MM-dd` day of the store's timezone, turned into instants
 * here — MySQL never needs timezone tables.
 */
export const FINANCE_PERIODS = [
  "today",
  "yesterday",
  "7d",
  "month",
  "lastMonth",
  "custom",
] as const;

export type FinancePeriod = (typeof FINANCE_PERIODS)[number];

export const DEFAULT_FINANCE_PERIOD: FinancePeriod = "month";

/** Longest custom range, in days: past a year the daily ledger stops being a till. */
export const MAX_FINANCE_RANGE_DAYS = 366;

/** Above this many days the chart groups by month instead of by day. */
const DAILY_BUCKET_LIMIT = 92;

export interface FinanceDayRange {
  /** First day, inclusive. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

export interface FinancePeriodInput {
  period?: FinancePeriod;
  from?: string;
  to?: string;
}

export interface FinanceBucket {
  /** `yyyy-MM-dd` of the bucket's first day. */
  key: string;
  start: Date;
  end: Date;
}

export interface FinanceWindow extends FinanceDayRange {
  period: FinancePeriod;
  timezone: string;
  /** Half-open `[start, end)`. `end` never runs past `now`: nothing is cashed in the future. */
  start: Date;
  end: Date;
  /** The window of the same length right before `start`, for the trends. */
  previousStart: Date;
  previousEnd: Date;
  granularity: "day" | "month";
  buckets: FinanceBucket[];
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The store's timezone when it is a usable IANA name, UTC otherwise. */
export const resolveFinanceTimezone = (timezone: string | null | undefined): string => {
  const candidate = timezone?.trim();
  if (!candidate) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
};

const toEpochDay = (day: string): number => Date.parse(`${day}T00:00:00.000Z`) / 86_400_000;

const fromEpochDay = (epochDay: number): string =>
  new Date(epochDay * 86_400_000).toISOString().slice(0, 10);

export const isFinanceDay = (value: string | null | undefined): value is string =>
  typeof value === "string" && DAY_PATTERN.test(value) && Number.isFinite(toEpochDay(value));

export const addFinanceDays = (day: string, amount: number): string =>
  fromEpochDay(toEpochDay(day) + amount);

const startOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

const startOfNextMonth = (day: string): string => {
  const [year, month] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 1)).toISOString().slice(0, 10);
};

/** Midnight of a store day, as an instant. */
const startOfStoreDay = (day: string, timezone: string): Date =>
  fromZonedTime(`${day}T00:00:00.000`, timezone);

/** The store day an instant falls on, as `yyyy-MM-dd`. */
export const getFinanceDayKey = (date: Date, timezone: string): string =>
  formatInTimeZone(date, timezone, "yyyy-MM-dd");

/** The instants a store day runs between, `[start, end)`: 23 or 25 hours on a DST change. */
export const getFinanceDayBounds = (day: string, timezone: string): { start: Date; end: Date } => ({
  start: startOfStoreDay(day, timezone),
  end: startOfStoreDay(addFinanceDays(day, 1), timezone),
});

/** The days a period covers, in the store's timezone. An unusable custom range falls back to the default period. */
export const getFinanceDayRange = (
  input: FinancePeriodInput,
  now: Date,
  timezone?: string | null,
): FinanceDayRange & { period: FinancePeriod } => {
  const today = getFinanceDayKey(now, resolveFinanceTimezone(timezone));
  const period = input.period ?? DEFAULT_FINANCE_PERIOD;

  if (period === "custom" && isFinanceDay(input.from) && isFinanceDay(input.to)) {
    const to = input.to < input.from ? input.from : input.to;
    const earliest = addFinanceDays(to, -(MAX_FINANCE_RANGE_DAYS - 1));
    return { period, from: input.from < earliest ? earliest : input.from, to };
  }

  switch (period) {
    case "today":
      return { period, from: today, to: today };
    case "yesterday":
      return { period, from: addFinanceDays(today, -1), to: addFinanceDays(today, -1) };
    case "7d":
      return { period, from: addFinanceDays(today, -6), to: today };
    case "lastMonth": {
      const lastDay = addFinanceDays(startOfMonth(today), -1);
      return { period, from: startOfMonth(lastDay), to: lastDay };
    }
    default:
      return { period: DEFAULT_FINANCE_PERIOD, from: startOfMonth(today), to: today };
  }
};

export const getFinanceWindow = (
  input: FinancePeriodInput,
  now: Date,
  timezone?: string | null,
): FinanceWindow => {
  const resolvedTimezone = resolveFinanceTimezone(timezone);
  const { period, from, to } = getFinanceDayRange(input, now, resolvedTimezone);
  const dayCount = toEpochDay(to) - toEpochDay(from) + 1;

  const start = startOfStoreDay(from, resolvedTimezone);
  const fullEnd = startOfStoreDay(addFinanceDays(to, 1), resolvedTimezone);
  const end = new Date(Math.max(start.getTime(), Math.min(fullEnd.getTime(), now.getTime())));
  const isRunning = end.getTime() < fullEnd.getTime();

  // A period still running is compared with the same stretch of the previous
  // one ("today until 5pm" against "yesterday until 5pm"), a finished period
  // with the whole period before it.
  const previousStart = startOfStoreDay(addFinanceDays(from, -dayCount), resolvedTimezone);
  const previousEnd = isRunning
    ? new Date(Math.min(start.getTime(), previousStart.getTime() + end.getTime() - start.getTime()))
    : start;

  const granularity = dayCount > DAILY_BUCKET_LIMIT ? "month" : "day";
  const buckets: FinanceBucket[] = [];
  let cursor = from;
  while (cursor <= to) {
    const next = granularity === "month" ? startOfNextMonth(cursor) : addFinanceDays(cursor, 1);
    const bucketStart = startOfStoreDay(cursor, resolvedTimezone);
    if (bucketStart.getTime() >= end.getTime()) break;
    const bucketEnd = startOfStoreDay(next > to ? addFinanceDays(to, 1) : next, resolvedTimezone);
    buckets.push({
      key: cursor,
      start: bucketStart,
      end: new Date(Math.min(bucketEnd.getTime(), end.getTime())),
    });
    cursor = next;
  }

  return {
    period,
    from,
    to,
    timezone: resolvedTimezone,
    start,
    end,
    previousStart,
    previousEnd,
    granularity,
    buckets,
  };
};

/** Growth in percent, undefined when there was nothing to compare with. */
export const getFinanceGrowth = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : current === 0 ? 0 : null;

import { addDays, addMonths, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import {
  ANALYTICS_PERIODS,
  DEFAULT_ANALYTICS_PERIOD,
  type AnalyticsPeriod,
} from "../contracts/analytics";

/**
 * The windows the sales figures cover: the dashboard's sales pages, its home
 * and the statistics procedures all count over these. A window is a half-open
 * interval of instants, cut at the store's midnight.
 */

export interface SalesWindow {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  granularity: "day" | "month";
  timezone: string;
  buckets: { start: Date; end: Date }[];
}

/**
 * `days` sizes the rolling window (KPIs, top products); `granularity` decides
 * how that window is bucketed on the charts: daily for the short periods,
 * calendar months for the long ones.
 */
type PeriodConfig =
  | { days: number; granularity: "day" }
  | { days: number; granularity: "month"; months: number };

const PERIOD_CONFIGS: Record<AnalyticsPeriod, PeriodConfig> = {
  "7d": { days: 7, granularity: "day" },
  "30d": { days: 30, granularity: "day" },
  "90d": { days: 90, granularity: "day" },
  "6m": { days: 180, granularity: "month", months: 6 },
  "12m": { days: 365, granularity: "month", months: 12 },
};

export const getPeriodConfig = (period: AnalyticsPeriod): PeriodConfig =>
  PERIOD_CONFIGS[period] ?? PERIOD_CONFIGS[DEFAULT_ANALYTICS_PERIOD];

export const isAnalyticsPeriod = (value: unknown): value is AnalyticsPeriod =>
  ANALYTICS_PERIODS.includes(value as AnalyticsPeriod);

/** A custom range longer than this is bucketed by month. */
const DAILY_RANGE_MAX_DAYS = 92;

/** The store's time zone when it is a valid IANA name, else UTC. */
export function resolveTimezone(timezone: string | null | undefined): string {
  const name = timezone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: name }).format(new Date());
    return name;
  } catch {
    return "UTC";
  }
}

/**
 * One bucket per day or calendar month from `localStart`, each cut at `end`.
 * A rolling window keeps the current bucket even when it is still empty (at
 * midnight); a closed range does not add one past its end.
 */
function windowFrom(
  localStart: Date,
  end: Date,
  granularity: SalesWindow["granularity"],
  timezone: string,
  rolling: boolean,
): SalesWindow {
  const start = fromZonedTime(localStart, timezone);
  const buckets: SalesWindow["buckets"] = [];
  let cursor = localStart;
  for (;;) {
    const cursorStart = fromZonedTime(cursor, timezone);
    if (rolling ? cursorStart > end : cursorStart >= end) break;
    const next = granularity === "month" ? startOfMonth(addMonths(cursor, 1)) : addDays(cursor, 1);
    buckets.push({
      start: cursorStart,
      end: new Date(Math.min(fromZonedTime(next, timezone).getTime(), end.getTime())),
    });
    cursor = next;
  }
  return {
    start,
    end,
    previousEnd: start,
    previousStart: new Date(start.getTime() - (end.getTime() - start.getTime())),
    granularity,
    timezone,
    buckets,
  };
}

/** All sales blocks use this half-open interval and the same observation time. */
export function getSalesWindow(period: AnalyticsPeriod, now: Date, timezone = "UTC"): SalesWindow {
  const zone = resolveTimezone(timezone);
  const config = getPeriodConfig(period);
  const localNow = toZonedTime(now, zone);
  const localStart =
    config.granularity === "month"
      ? startOfMonth(subMonths(localNow, config.months - 1))
      : startOfDay(subDays(localNow, config.days - 1));
  return windowFrom(localStart, now, config.granularity, zone, true);
}

/**
 * A custom range of whole store days, `from` and `to` (YYYY-MM-DD) both
 * included, ending at `now` at the latest. A range that starts after `now`
 * is empty.
 */
export function getSalesWindowForDates(
  from: string,
  to: string,
  now: Date,
  timezone = "UTC",
): SalesWindow {
  const zone = resolveTimezone(timezone);
  const localStart = new Date(`${from}T00:00:00`);
  const localEnd = addDays(new Date(`${to}T00:00:00`), 1);
  const start = fromZonedTime(localStart, zone);
  const end = new Date(
    Math.max(start.getTime(), Math.min(fromZonedTime(localEnd, zone).getTime(), now.getTime())),
  );
  const days = Math.round((localEnd.getTime() - localStart.getTime()) / 86_400_000);
  return windowFrom(localStart, end, days > DAILY_RANGE_MAX_DAYS ? "month" : "day", zone, false);
}

/** The store's today and months, for the dashboard's home. */
export interface StoreCalendar {
  timezone: string;
  todayStart: Date;
  tomorrowStart: Date;
  monthStart: Date;
  lastMonthStart: Date;
}

export function getStoreCalendar(now: Date, timezone: string | null | undefined): StoreCalendar {
  const zone = resolveTimezone(timezone);
  const localNow = toZonedTime(now, zone);
  const localToday = startOfDay(localNow);
  return {
    timezone: zone,
    todayStart: fromZonedTime(localToday, zone),
    tomorrowStart: fromZonedTime(addDays(localToday, 1), zone),
    monthStart: fromZonedTime(startOfMonth(localNow), zone),
    lastMonthStart: fromZonedTime(startOfMonth(subMonths(localNow, 1)), zone),
  };
}

export const roundSalesAmount = (amount: number): number => Math.round(amount * 100) / 100;

/** Growth is undefined when there was no revenue in the previous period. */
export const getSalesGrowth = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : current === 0 ? 0 : null;

/** Distribute rounding cents by largest remainder so displayed shares sum to the receipt total. */
export function allocateSalesAmounts(amounts: number[], total: number): number[] {
  const cents = amounts.map((amount) => Math.floor(amount * 100 + 1e-7));
  const remainder = Math.round(total * 100) - cents.reduce((sum, amount) => sum + amount, 0);
  const order = amounts
    .map((amount, index) => ({ index, fraction: amount * 100 - cents[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) {
    const entry = order[i];
    if (entry) cents[entry.index] += 1;
  }
  return cents.map((amount) => amount / 100);
}

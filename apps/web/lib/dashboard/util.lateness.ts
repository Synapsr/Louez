import { differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type LatenessUnit = "minutes" | "hours" | "days";

export interface Lateness {
  unit: LatenessUnit;
  value: number;
}

/**
 * How late something is, in the unit a person would say it: minutes within
 * the hour, hours within the day — often a customer on their way — then
 * calendar days on the store's clock, so yesterday evening is "1 day" the
 * next morning.
 */
export const getLateness = (dueAt: Date, now: Date, timezone: string): Lateness => {
  const elapsed = Math.max(0, now.getTime() - dueAt.getTime());
  if (elapsed < HOUR_MS)
    return { unit: "minutes", value: Math.max(1, Math.floor(elapsed / MINUTE_MS)) };
  if (elapsed < DAY_MS) return { unit: "hours", value: Math.floor(elapsed / HOUR_MS) };
  return {
    unit: "days",
    value: Math.max(
      1,
      differenceInCalendarDays(toZonedTime(now, timezone), toZonedTime(dueAt, timezone)),
    ),
  };
};

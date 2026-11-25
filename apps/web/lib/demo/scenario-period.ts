import { parisDayAt } from "./paris-time";
import type { DemoScenario, DemoVertical } from "./verticals/types";

type OpeningRange = { openTime: string; closeTime: string };

const minutesOf = (clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
};

/** The first opening range of the Paris day `dayOffset` days from `now`, or null when closed. */
function firstRangeOf(
  vertical: Pick<DemoVertical, "settings">,
  now: Date,
  dayOffset: number,
): OpeningRange | null {
  const weekday = parisDayAt(now, dayOffset, 12).getUTCDay();
  return vertical.settings.openingHours[weekday]?.[0] ?? null;
}

const at = (now: Date, dayOffset: number, minutes: number) =>
  parisDayAt(now, dayOffset, Math.floor(minutes / 60), minutes % 60);

/**
 * The scenario's period: the next `startWeekday` past the store's advance
 * notice (two days out at least), to `days` days later (the next open day when
 * the store is closed then). Both ends at the same time of day when the store
 * is open then on both days, the later of their openings: the rental lasts
 * whole days and is priced as such.
 */
export function scenarioPeriod(
  vertical: Pick<DemoVertical, "settings">,
  scenario: Pick<DemoScenario, "startWeekday" | "days">,
  now: Date,
): { start: Date; end: Date } {
  let startOffset = Math.max(2, 1 + Math.ceil(vertical.settings.advanceNoticeMinutes / 1440));
  let startRange = firstRangeOf(vertical, now, startOffset);
  while (parisDayAt(now, startOffset, 12).getUTCDay() !== scenario.startWeekday || !startRange) {
    startOffset++;
    startRange = firstRangeOf(vertical, now, startOffset);
  }
  let endOffset = startOffset + scenario.days;
  let endRange = firstRangeOf(vertical, now, endOffset);
  while (!endRange) {
    endOffset++;
    endRange = firstRangeOf(vertical, now, endOffset);
  }

  const clock = Math.max(minutesOf(startRange.openTime), minutesOf(endRange.openTime));
  if (clock < minutesOf(startRange.closeTime) && clock < minutesOf(endRange.closeTime)) {
    return { start: at(now, startOffset, clock), end: at(now, endOffset, clock) };
  }
  return {
    start: at(now, startOffset, minutesOf(startRange.openTime)),
    end: at(now, endOffset, minutesOf(endRange.openTime)),
  };
}

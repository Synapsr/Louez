"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

const MINUTES = {
  hour: 60,
  day: 1440,
  week: 10080,
} as const;

/** Literal keys, so next-intl keeps checking them against `messages/*.json`. */
const UNIT_KEY = {
  minute: "minuteUnit",
  hour: "hourUnit",
  day: "dayUnit",
  week: "weekUnit",
  month: "monthUnit",
  year: "yearUnit",
} as const;

type UnitName = keyof typeof UNIT_KEY;

/**
 * Compact duration labels for rate ladders, chart axes and price previews:
 * "10 j 12 h", "2 sem", "45 min". Compound labels appear when a value does not
 * divide evenly into the larger unit, because "1,5 j" reads as a price, not a stay.
 */
export function useDurationFormat() {
  const t = useTranslations("common");

  const short = useCallback(
    (minutes: number): string => {
      const abbrev = (unit: UnitName, count: number) =>
        `${count} ${t(UNIT_KEY[unit], { count }).charAt(0).toLowerCase()}`;

      if (minutes <= 0) return "—";
      if (minutes >= MINUTES.week && minutes % MINUTES.week === 0) {
        return abbrev("week", minutes / MINUTES.week);
      }
      if (minutes >= MINUTES.day) {
        const days = Math.floor(minutes / MINUTES.day);
        const hours = Math.round((minutes % MINUTES.day) / MINUTES.hour);
        return hours === 0
          ? abbrev("day", days)
          : `${abbrev("day", days)} ${abbrev("hour", hours)}`;
      }
      if (minutes >= MINUTES.hour) {
        return abbrev("hour", Math.round(minutes / MINUTES.hour));
      }
      return abbrev("minute", minutes);
    },
    [t],
  );

  /** "3 mois", "1 an" — spelled out, for labels that are read rather than scanned. */
  const long = useCallback(
    (count: number, unit: UnitName) => `${count} ${t(UNIT_KEY[unit], { count })}`,
    [t],
  );

  return { short, long };
}

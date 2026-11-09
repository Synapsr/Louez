"use client";

import { useFormatter, useTranslations } from "next-intl";

export interface UpcomingDay {
  /** Midnight of the day, server-side. */
  date: Date;
  departures: number;
  returns: number;
}

/**
 * What the next days hold, so a quiet day still tells what comes next.
 */
export const UpcomingDays = ({ days }: { days: UpcomingDay[] }) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();

  return (
    <div className="w-full space-y-2 text-left">
      <p className="text-sm font-bold">{t("upcoming.title")}</p>
      <div className="grid grid-cols-3 gap-2.5">
        {days.map((day, index) => (
          <div key={day.date.toISOString()} className="bg-muted flex flex-col gap-0.5 rounded-xl p-3 text-sm">
            <span className="font-semibold first-letter:uppercase">
              {index === 0 ? t("upcoming.tomorrow") : format.dateTime(day.date, { weekday: "long" })}
            </span>
            <span className="text-muted-foreground text-xs">
              {day.departures + day.returns === 0
                ? t("upcoming.nothing")
                : [
                    day.departures > 0 ? t("upcoming.departures", { count: day.departures }) : null,
                    day.returns > 0 ? t("upcoming.returns", { count: day.returns }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

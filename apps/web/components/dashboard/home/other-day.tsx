"use client";

import type { ReactNode } from "react";

import { useFormatter, useTranslations } from "next-intl";

import { Skeleton } from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import { buildDayAgenda } from "@/lib/dashboard/util.day-agenda";
import { getCalendarDayHref } from "@/lib/dashboard/util.home-links";
import { addStoreDays, resolveStoreTimezone, storeDayKey } from "@/lib/dashboard/util.store-day";
import { findNextActivity, splitDay } from "@/lib/dashboard/util.week-agenda";

import { DayAgenda } from "./day-agenda";
import { HomeScrollZone } from "./home-scroll-zone";
import type { HomeNextActivity } from "./home-types";
import { NothingPlanned } from "./nothing-planned";
import { NEXT_ACTIVITY_HORIZON_DAYS, type WeekReservation } from "./util.week-reservations";

const SKELETON_ROWS = 3;

interface OtherDayProps {
  /** The picked day, at the store's midnight. */
  date: Date;
  /** The reservations of the week the day belongs to. */
  reservations: WeekReservation[];
  isLoading: boolean;
  isError: boolean;
  now: Date;
  /** The page's next activity after today: beyond what is loaded here, the best known. */
  knownNextActivity: HomeNextActivity | null;
  /** What to do when nothing comes next. */
  action: ReactNode;
  onGoToDay: (date: Date) => void;
}

/**
 * A day other than today, picked in the week calendar: its hand-overs and
 * returns in the same list as today's — "now" only shows where it falls —
 * or that nothing is planned, with the next day that has something.
 */
export const OtherDay = ({
  date,
  reservations,
  isLoading,
  isError,
  now,
  knownNextActivity,
  action,
  onGoToDay,
}: OtherDayProps) => {
  const t = useTranslations("dashboard.home.today.otherDay");
  const format = useFormatter();
  const timeZone = resolveStoreTimezone(useStore().timezone);
  const calendarHref = getCalendarDayHref(date, timeZone);

  if (isLoading) {
    return (
      <div aria-busy className="flex flex-col gap-2">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{t("error")}</p>;
  }

  const split = splitDay(reservations, storeDayKey(date, timeZone), timeZone);
  const agenda = buildDayAgenda({ ...split, now });

  if (agenda.entries.length === 0) {
    const dayKey = storeDayKey(date, timeZone);
    const horizonKey = storeDayKey(
      addStoreDays(date, NEXT_ACTIVITY_HORIZON_DAYS, timeZone),
      timeZone,
    );
    // Within the loaded weeks, the answer is exact; past them, the page's own
    // next activity still holds if it falls after this day.
    const nextActivity =
      findNextActivity(reservations, dayKey, horizonKey, timeZone) ??
      (knownNextActivity && storeDayKey(knownNextActivity.date, timeZone) > horizonKey
        ? knownNextActivity
        : null);
    return (
      <div className="flex flex-1 flex-col justify-center">
        <NothingPlanned
          nextActivity={nextActivity}
          noneText={t("noneSoon", { weeks: NEXT_ACTIVITY_HORIZON_DAYS / 7 })}
          action={action}
          onGoToDay={onGoToDay}
        />
      </div>
    );
  }

  return (
    <HomeScrollZone
      label={format.dateTime(date, { weekday: "long", day: "numeric", month: "long", timeZone })}
    >
      <DayAgenda
        agenda={agenda}
        total={agenda.entries.length}
        calendarHref={calendarHref}
        now={now}
      />
    </HomeScrollZone>
  );
};

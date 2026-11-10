"use client";

import { Fragment } from "react";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { useStore } from "@/contexts/store-context";
import type { DayAgenda as DayAgendaData } from "@/lib/dashboard/util.day-agenda";
import { TODAY_CALENDAR_HREF } from "@/lib/dashboard/util.home-links";
import { resolveStoreTimezone } from "@/lib/dashboard/util.store-day";

import { AgendaListItem } from "./agenda-list-item";
import { HomeListMore } from "./home-list-more";
import type { HomeReservation } from "./home-types";

/** Rows shown while the cards are stacked; side by side, the card scrolls. */
const STACKED_ROWS = 8;

interface DayAgendaProps {
  agenda: DayAgendaData<HomeReservation>;
  /** Every hand-over and return of the day, loaded or not. */
  total: number;
  /** Where "see all" leads: the calendar on that day. Today's by default. */
  calendarHref?: string;
  now: Date;
  /** Today's agenda can be finished; another day's is only read. */
  isToday?: boolean;
}

/**
 * A day's hand-overs and returns in one list, in time order, with a line
 * where "now" falls: what is done or late above it, what comes next below.
 */
export const DayAgenda = ({
  agenda,
  total,
  calendarHref = TODAY_CALENDAR_HREF,
  now,
  isToday = false,
}: DayAgendaProps) => {
  const t = useTranslations("dashboard.home");
  const timeZone = resolveStoreTimezone(useStore().timezone);
  const { entries, nowIndex } = agenda;
  const showNow = nowIndex > 0 && nowIndex < entries.length;
  // Everything behind "now", nothing late, nothing more to load: the day is done.
  const isDayDone =
    isToday &&
    entries.length > 0 &&
    nowIndex >= entries.length &&
    total <= entries.length &&
    entries.every((entry) => !entry.reservation.isOverdue);

  return (
    <div className="flex flex-col">
      <div className="-mx-2 space-y-0.5 sm:-mx-3">
        {entries.map((entry, index) => (
          <Fragment key={`${entry.kind}-${entry.reservation.id}`}>
            {showNow && index === nowIndex && (
              <div
                className={cn(
                  "text-destructive flex items-center gap-2 px-2 py-1 text-[11px] font-bold tracking-wider uppercase sm:px-3",
                  index >= STACKED_ROWS && "@max-[55rem]/home:hidden",
                )}
              >
                <span aria-hidden className="bg-destructive size-1.5 rounded-full" />
                {t("today.agenda.now")}
                <span aria-hidden className="bg-destructive/50 h-px flex-1" />
              </div>
            )}
            <AgendaListItem
              entry={entry}
              timeZone={timeZone}
              thread={
                entries.length === 1
                  ? "only"
                  : index === 0
                    ? "first"
                    : index === entries.length - 1
                      ? "last"
                      : "middle"
              }
              isDone={index < nowIndex && !entry.reservation.isOverdue}
              now={now}
              className={cn(index >= STACKED_ROWS && "@max-[55rem]/home:hidden")}
            />
          </Fragment>
        ))}
      </div>
      {isDayDone && (
        <p className="text-success flex items-center gap-2 px-0 pt-3 text-sm font-semibold">
          <span
            aria-hidden
            className="bg-success/12 flex size-6 items-center justify-center rounded-full"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          {t("today.agenda.allDone")}
        </p>
      )}
      <HomeListMore
        href={calendarHref}
        count={total - STACKED_ROWS}
        className="-mx-2 @min-[55rem]/home:hidden sm:-mx-3"
      />
      <HomeListMore
        href={calendarHref}
        count={total - entries.length}
        className="-mx-2 @max-[55rem]/home:hidden sm:-mx-3"
      />
    </div>
  );
};

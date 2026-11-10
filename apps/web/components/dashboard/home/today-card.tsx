"use client";

import { useState } from "react";

import { useQueries } from "@tanstack/react-query";

import { differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import Link from "next/link";

import { ArrowDownRight, ArrowUpRight, CalendarDays, Plus, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { ReservationsGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { useStore } from "@/contexts/store-context";
import { buildDayAgenda } from "@/lib/dashboard/util.day-agenda";
import { getCalendarDayHref } from "@/lib/dashboard/util.home-links";
import type { HomeTipKey } from "@/lib/dashboard/util.home-tip";
import { getOverdueSummary } from "@/lib/dashboard/util.overdue-summary";
import { addStoreDays, resolveStoreTimezone, storeDayKey } from "@/lib/dashboard/util.store-day";
import { splitDay } from "@/lib/dashboard/util.week-agenda";
import { reservationCalendarQueries } from "@/lib/queries/reservation-calendar.queries";

import { DayAgenda } from "./day-agenda";
import { HomeEmptyState } from "./home-empty-state";
import { HomeScrollZone } from "./home-scroll-zone";
import { HomeTip } from "./home-tip";
import type {
  HomeCalendarDay,
  HomeNextActivity,
  HomeReservation,
  OverdueHomeReservation,
  StoreMetrics,
  StoreState,
} from "./home-types";
import { HomeWeekCalendar } from "./home-week-calendar";
import { OverdueCompact } from "./overdue-compact";
import { NothingPlanned } from "./nothing-planned";
import { OtherDay } from "./other-day";
import {
  NEXT_ACTIVITY_HORIZON_DAYS,
  toWeekReservations,
  WEEK_DAYS,
} from "./util.week-reservations";

const CREATE_RESERVATION_HREF = "/dashboard/reservations/new?source=dashboard_header";

interface TodayCardProps {
  storeState: StoreState;
  metrics: StoreMetrics;
  departures: HomeReservation[];
  returns: HomeReservation[];
  /** The oldest of what previous days left behind, per kind. */
  overdue: OverdueHomeReservation[];
  /** Today and the six days after it, always seven days. */
  week: HomeCalendarDay[];
  /** For a day with nothing planned: the next one that has something. */
  nextActivity: HomeNextActivity | null;
  /** A starting store's next step, when there is no requests card to hold it. */
  tip: HomeTipKey | null;
  /** Server-side start of the store's today, for the card's date. */
  today: Date;
  /** Server-side "now", so times and the agenda's "now" match the markup. */
  now: Date;
  className?: string;
}

/**
 * Today's work, in one shape for every state: the week calendar on top,
 * always; what previous days left to settle; then the day's agenda — or, when
 * there is nothing, the home's empty state with what to do or what comes
 * next. A new store reads the same card, just empty.
 *
 * The calendar moves a week at a time and any day can be picked: the card
 * then reads that day — its agenda, or that nothing is planned — until the
 * owner comes back to today; what is left to settle stays in view all along, in one line.
 * Other days load from the reservations calendar's
 * own queries, only once asked for.
 */
export const TodayCard = ({
  storeState,
  metrics,
  departures,
  returns,
  overdue,
  week,
  nextActivity,
  tip,
  today,
  now,
  className,
}: TodayCardProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  const { storeId, timezone } = useStore();
  const timeZone = resolveStoreTimezone(timezone);
  const isNew = storeState === "virgin" || storeState === "building";

  const todayKey = storeDayKey(today, timeZone);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(today);
  // The week's previews need its reservations: loaded once the pointer comes.
  const [wantsPreview, setWantsPreview] = useState(false);
  const selectedKey = storeDayKey(selectedDate, timeZone);
  const isOtherDay = selectedKey !== todayKey;
  const weekStart = addStoreDays(today, weekOffset * WEEK_DAYS, timeZone);
  // Other weeks, and this one's previews, read the reservations calendar's own
  // 28-day chunks — sharing their cache — only once the owner reaches for them.
  const weekQueries = useQueries({
    queries: reservationCalendarQueries
      .forWindow(storeId, weekStart, WEEK_DAYS + NEXT_ACTIVITY_HORIZON_DAYS)
      .map((query) => ({ ...query, enabled: weekOffset !== 0 || isOtherDay || wantsPreview })),
  });
  const otherWeek = {
    reservations: toWeekReservations(weekQueries.map((query) => query.data)),
    isLoading: weekQueries.some((query) => query.isLoading),
    isError: weekQueries.some((query) => query.isError),
  };

  // This week's counts come with the page; another week's from its reservations.
  const days =
    weekOffset === 0
      ? week
      : Array.from({ length: WEEK_DAYS }, (_, index) => {
          const date = addStoreDays(weekStart, index, timeZone);
          const split = splitDay(otherWeek.reservations, storeDayKey(date, timeZone), timeZone);
          return { date, departures: split.departures.length, returns: split.returns.length };
        });

  const getAgenda = (date: Date) => {
    const key = storeDayKey(date, timeZone);
    if (key === todayKey) return agenda;
    if (otherWeek.isLoading || otherWeek.isError) return null;
    return buildDayAgenda({ ...splitDay(otherWeek.reservations, key, timeZone), now });
  };

  const goToWeek = (offset: number) => {
    setWeekOffset(offset);
    // Back on this week, today; elsewhere, the week's first day.
    setSelectedDate(offset === 0 ? today : addStoreDays(today, offset * WEEK_DAYS, timeZone));
  };
  const backToToday = () => goToWeek(0);
  // Any day, however far: its week comes into view and the day is picked.
  const goToDay = (date: Date) => {
    const offset = differenceInCalendarDays(
      toZonedTime(date, timeZone),
      toZonedTime(today, timeZone),
    );
    setWeekOffset(Math.floor(offset / WEEK_DAYS));
    setSelectedDate(addStoreDays(date, 0, timeZone));
  };

  const agenda = buildDayAgenda({ departures, returns, now });
  const hasOperations = agenda.entries.length > 0;
  const overdueSummary = getOverdueSummary({
    rows: overdue,
    overdueReturns: metrics.overdueReturns,
    overdueDepartures: metrics.overdueDepartures,
  });

  // The full calendar, open on the day being read.
  const calendarLink = (
    <Button
      size="sm"
      variant="outline"
      render={<Link href={getCalendarDayHref(selectedDate, timeZone)} />}
      aria-label={t("today.otherDay.openCalendar")}
      title={t("today.otherDay.openCalendar")}
    >
      <CalendarDays />
      {t("today.calendar")}
    </Button>
  );

  const counts = (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {/* The late ones are counted once, in their own block below. */}
      {hasOperations ? (
        <>
          <span className="bg-success/12 text-success inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold">
            <ArrowUpRight className="size-3" strokeWidth={3} />
            {t("today.departures", { count: metrics.todaysDepartures })}
          </span>
          <span className="bg-accent text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold">
            <ArrowDownRight className="size-3" strokeWidth={3} />
            {t("today.returns", { count: metrics.todaysReturns })}
          </span>
        </>
      ) : null}
      {calendarLink}
    </span>
  );

  const createReservation = (
    <Button size="sm" variant="outline" render={<Link href={CREATE_RESERVATION_HREF} />}>
      <Plus />
      {t("today.createReservation")}
    </Button>
  );

  const empty = (() => {
    if (isNew) {
      return (
        <HomeEmptyState
          size="compact"
          illustration={{ main: ReservationsGlassIcon }}
          title={t("today.emptyTitle")}
          description={t("today.emptyText")}
          story="firstDay"
          action={createReservation}
        />
      );
    }
    return (
      <NothingPlanned
        nextActivity={nextActivity}
        noneText={t("today.quiet.none")}
        onGoToDay={goToDay}
        // Nothing planned at all: entering a booking is the way forward.
        action={createReservation}
      />
    );
  })();

  // One line, today as on any other day: seen, without taking the agenda's room.
  const toSettle =
    overdueSummary.total > 0 ? (
      <OverdueCompact summary={overdueSummary} rows={overdue} now={now} />
    ) : null;

  const calendar = (
    <HomeWeekCalendar
      days={days}
      todayKey={todayKey}
      selectedKey={selectedKey}
      onSelect={setSelectedDate}
      onPrevious={() => goToWeek(weekOffset - 1)}
      onNext={() => goToWeek(weekOffset + 1)}
      isLoading={weekOffset !== 0 && otherWeek.isLoading}
      getAgenda={getAgenda}
      onPreview={() => setWantsPreview(true)}
    />
  );

  if (isOtherDay) {
    return (
      <DashboardSectionCard
        title={format.dateTime(selectedDate, {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone,
        })}
        action={
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={backToToday}>
              <Undo2 />
              {t("today.otherDay.backToToday")}
            </Button>
            {calendarLink}
          </span>
        }
        className={cn(
          "@min-[55rem]/home:min-h-0 [&_[data-slot=card-title]]:first-letter:uppercase",
          className,
        )}
        contentClassName="flex min-h-0 flex-col gap-4"
      >
        {calendar}
        {/* Late hand-overs and returns stay in sight whatever the day being read. */}
        {toSettle}
        <OtherDay
          date={selectedDate}
          reservations={otherWeek.reservations}
          isLoading={otherWeek.isLoading}
          isError={otherWeek.isError}
          now={now}
          knownNextActivity={nextActivity}
          action={createReservation}
          onGoToDay={goToDay}
        />
      </DashboardSectionCard>
    );
  }

  return (
    <DashboardSectionCard
      title={t("today.title")}
      action={counts}
      className={cn("@min-[55rem]/home:min-h-0", className)}
      contentClassName="flex min-h-0 flex-col gap-4"
    >
      {calendar}
      {toSettle}
      {hasOperations ? (
        <HomeScrollZone label={t("today.title")}>
          <DayAgenda
            agenda={agenda}
            total={metrics.todaysDepartures + metrics.todaysReturns}
            now={now}
            isToday
          />
        </HomeScrollZone>
      ) : (
        <div className="flex flex-1 flex-col justify-center">{empty}</div>
      )}
      {tip && (
        <div className="shrink-0">
          <HomeTip tip={tip} />
        </div>
      )}
    </DashboardSectionCard>
  );
};

"use client";

import { useFormatter, useTranslations } from "next-intl";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { ReservationsGlassIcon, WhatsNewGlassIcon, HomeGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import { ActivityListItem } from "./activity-list-item";
import { DayTimeline } from "./day-timeline";
import { HomeEmptyState } from "./home-empty-state";
import type { HomeReservation, StoreMetrics, StoreState } from "./home-types";
import { type UpcomingDay, UpcomingDays } from "./upcoming-days";

interface TodayCardProps {
  storeState: StoreState;
  metrics: StoreMetrics;
  departures: HomeReservation[];
  returns: HomeReservation[];
  /** The next days, loaded only for a quiet day. */
  upcoming: UpcomingDay[] | null;
  /** Server-side "today", for the card's date. */
  today: Date;
  className?: string;
}

/**
 * Today's work: hand-overs and returns on a line of hours, then the two lists.
 * A new store learns what the card will hold; a quiet day shows what is next.
 */
export const TodayCard = ({
  storeState,
  metrics,
  departures,
  returns,
  upcoming,
  today,
  className,
}: TodayCardProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  const isNew = storeState === "virgin" || storeState === "building";
  const hasOperations = departures.length > 0 || returns.length > 0;

  const counts =
    !isNew && hasOperations ? (
      <span className="flex items-center gap-1.5">
        <span className="bg-success/12 text-success inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold">
          <ArrowUpRight className="size-3" strokeWidth={3} />
          {t("today.departures", { count: metrics.todaysDepartures })}
        </span>
        <span className="bg-accent text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold">
          <ArrowDownRight className="size-3" strokeWidth={3} />
          {t("today.returns", { count: metrics.todaysReturns })}
        </span>
      </span>
    ) : (
      <span className="text-muted-foreground font-mono text-xs first-letter:uppercase">
        {format.dateTime(today, { weekday: "long", day: "numeric", month: "short" })}
      </span>
    );

  const body = (() => {
    if (isNew) {
      return (
        <HomeEmptyState
          size="compact"
          illustration={{ main: ReservationsGlassIcon }}
          title={t("today.emptyTitle")}
          description={t("today.emptyText")}
        />
      );
    }
    if (!hasOperations) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <HomeEmptyState
            size="compact"
            illustration={{ main: HomeGlassIcon, companions: [WhatsNewGlassIcon] }}
            title={t("activity.noActivityTitle")}
            description={t("activity.noActivityDescription")}
          />
          {upcoming && upcoming.length > 0 && <UpcomingDays days={upcoming} />}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-5">
        <DayTimeline departures={departures} returns={returns} />
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            { key: "departures", list: departures, hint: t("stats.toDeliver"), accent: "success" as const },
            { key: "returns", list: returns, hint: t("stats.toRecover"), accent: "progress" as const },
          ].map(({ key, list, hint, accent }) => (
            <div key={key} className="min-w-0">
              <p className="mb-1 flex items-baseline gap-2 text-sm font-bold">
                {t(key === "departures" ? "activity.departures" : "activity.returns")}
                <span className="text-muted-foreground text-xs font-medium">{hint}</span>
              </p>
              {list.length === 0 ? (
                <p className="text-muted-foreground py-2 text-sm">
                  {t(key === "departures" ? "activity.noDepartures" : "activity.noReturns")}
                </p>
              ) : (
                <div className="-mx-2 space-y-0.5">
                  {list.map((reservation) => (
                    <ActivityListItem
                      key={reservation.id}
                      reservation={reservation}
                      accent={accent}
                      source={key === "departures" ? "home_departure" : "home_return"}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  })();

  return (
    <DashboardSectionCard
      title={t("today.title")}
      action={counts}
      className={cn("min-h-full", className)}
      contentClassName="flex flex-col"
    >
      {body}
    </DashboardSectionCard>
  );
};

"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import type { DayAgenda } from "@/lib/dashboard/util.day-agenda";

import type { HomeCalendarDay, HomeReservation } from "./home-types";

/** Enough to tell the day at a glance; the rest is one click away. */
const PREVIEW_ROWS = 3;

interface WeekDayPreviewProps {
  day: HomeCalendarDay;
  /** The day's agenda, or null while it loads. */
  agenda: DayAgenda<HomeReservation> | null;
  timeZone: string;
}

/**
 * What a day of the week calendar holds, shown on hover: its first
 * hand-overs and returns — time, which way, who — and how many more.
 */
export const WeekDayPreview = ({ day, agenda, timeZone }: WeekDayPreviewProps) => {
  const t = useTranslations("dashboard.home.today");
  const format = useFormatter();
  const total = day.departures + day.returns;
  const shown = agenda?.entries.slice(0, PREVIEW_ROWS) ?? [];

  return (
    <div className="flex w-60 flex-col gap-1.5 py-1 text-start">
      <p className="font-semibold first-letter:uppercase">
        {format.dateTime(day.date, { weekday: "long", day: "numeric", month: "long", timeZone })}
      </p>
      {total === 0 ? (
        <p className="text-muted-foreground">{t("otherDay.emptyTitle")}</p>
      ) : agenda === null ? (
        <div aria-hidden className="flex flex-col gap-1.5 py-0.5">
          {Array.from({ length: Math.min(total, PREVIEW_ROWS) }, (_, index) => (
            <span key={index} className="bg-muted h-3 w-full animate-pulse rounded-full" />
          ))}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {shown.map(({ kind, at, reservation }) => {
              const Icon = kind === "departure" ? ArrowUpRight : ArrowDownRight;
              return (
                <li key={`${kind}-${reservation.id}`} className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {format.dateTime(at, { hour: "2-digit", minute: "2-digit", timeZone })}
                  </span>
                  <Icon
                    aria-label={t(kind === "departure" ? "agenda.departure" : "agenda.return")}
                    strokeWidth={3}
                    className={cn(
                      "size-3 shrink-0",
                      kind === "departure" ? "text-success" : "text-primary",
                    )}
                  />
                  <span className="min-w-0 truncate">
                    {`${reservation.customer.firstName} ${reservation.customer.lastName}`.trim()}
                  </span>
                </li>
              );
            })}
          </ul>
          {total > shown.length && (
            <p className="text-muted-foreground border-t pt-1.5">
              <span className="text-foreground font-semibold">
                {t("week.more", { count: total - shown.length })}
              </span>
              {" · "}
              {t("week.clickToSee")}
            </p>
          )}
        </>
      )}
    </div>
  );
};

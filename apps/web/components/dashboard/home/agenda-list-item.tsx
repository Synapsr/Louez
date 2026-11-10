"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";
import type { AgendaEntry } from "@/lib/dashboard/util.day-agenda";
import { getLateness } from "@/lib/dashboard/util.lateness";
import { getReservationDetailHref } from "@/lib/product-analytics/reservation-analytics";

import type { HomeReservation } from "./home-types";
import { ProductSummary } from "./product-summary";
import { ProductThumbs } from "./product-thumbs";
import { useLatenessText } from "./use-lateness-text";

/** Where the row sits on the day's thread: it starts, runs through, or ends there. */
export type AgendaThread = "only" | "first" | "middle" | "last";

interface AgendaListItemProps {
  entry: AgendaEntry<HomeReservation>;
  timeZone: string;
  thread: AgendaThread;
  /** Above "now" and recorded: done, so it steps back. */
  isDone?: boolean;
  /** For how late a hand-over or return not yet recorded is. */
  now: Date;
  className?: string;
}

/**
 * One line of the day's agenda: the time, a dot on the day's thread for
 * which way the gear goes, who in bold, then what — the first product and
 * how many more — with their photos and the reservation number at the end.
 * A hand-over or return whose time has passed without being recorded says
 * how late under its time; one that is done steps back.
 */
export const AgendaListItem = ({
  entry,
  timeZone,
  thread,
  isDone = false,
  now,
  className,
}: AgendaListItemProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  const latenessText = useLatenessText();
  const { reservation, kind } = entry;
  const isDeparture = kind === "departure";
  const Arrow = isDeparture ? ArrowUpRight : ArrowDownRight;

  return (
    <DashboardListRow
      href={getReservationDetailHref(
        reservation.id,
        isDeparture ? "home_departure" : "home_return",
      )}
      className={cn(
        isDone && "opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
      leading={
        <>
          <span className="flex w-11 shrink-0 flex-col font-mono text-sm leading-tight font-semibold tabular-nums">
            {format.dateTime(entry.at, { hour: "2-digit", minute: "2-digit", timeZone })}
            {/* Past its time and not recorded: how late, the way the
                overdue block says it. */}
            {reservation.isOverdue && (
              <span className="text-badge-failed-foreground text-[11px] font-bold">
                +{latenessText(getLateness(entry.at, now, timeZone))}
              </span>
            )}
          </span>
          <span
            aria-hidden
            className="relative flex w-7 shrink-0 self-stretch items-center justify-center"
          >
            {/* The day's thread, from the first row to the last; it reaches
                across the row's padding and the gap to the next row. */}
            {thread !== "only" && (
              <span
                className={cn(
                  "bg-border absolute start-1/2 w-0.5 -translate-x-1/2 rtl:translate-x-1/2",
                  thread === "first" && "top-1/2 -bottom-3.5",
                  thread === "middle" && "-top-3.5 -bottom-3.5",
                  thread === "last" && "-top-3.5 bottom-1/2",
                )}
              />
            )}
            <span
              className={cn(
                "relative flex size-6.5 items-center justify-center rounded-full",
                isDeparture ? "bg-success/12 text-success" : "bg-accent text-primary",
              )}
            >
              <Arrow className="size-3.5" strokeWidth={2.5} />
            </span>
          </span>
        </>
      }
      title={
        <>
          <span className="truncate font-semibold">
            {reservation.customer.firstName} {reservation.customer.lastName}
          </span>
        </>
      }
      subtitle={
        <>
          <span
            className={cn("shrink-0 font-semibold", isDeparture ? "text-success" : "text-primary")}
          >
            {t(isDeparture ? "today.agenda.departure" : "today.agenda.return")}
          </span>
          <span aria-hidden className="text-muted-foreground/60">
            ·
          </span>
          <ProductSummary items={reservation.items} />
        </>
      }
      meta={
        <span className="flex items-center gap-3">
          <ProductThumbs items={reservation.items} />
          {/* Some numbers run long (imports, tests): cut, the full one on hover. */}
          <span
            title={`#${reservation.number}`}
            className="text-muted-foreground/70 hidden max-w-28 truncate font-mono text-xs font-normal sm:inline"
          >
            #{reservation.number}
          </span>
        </span>
      }
    />
  );
};

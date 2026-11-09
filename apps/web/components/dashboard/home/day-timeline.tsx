"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { format } from "date-fns";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@louez/utils";

import { getReservationDetailHref } from "@/lib/product-analytics/reservation-analytics";

import type { HomeReservation } from "./home-types";
import { placeTimelineEvents } from "./util.day-timeline";

const NOW_REFRESH_MS = 60_000;

interface DayTimelineProps {
  departures: HomeReservation[];
  returns: HomeReservation[];
}

/**
 * Today's hand-overs and returns on one line of hours, with a marker for now:
 * what is past fades, an overdue one is ringed in red. Each chip opens its
 * reservation. The marker only appears once mounted, so the server markup
 * never disagrees with the browser's clock.
 */
export const DayTimeline = ({ departures, returns }: DayTimelineProps) => {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), NOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const { events, startHour, endHour } = placeTimelineEvents({ departures, returns });
  const span = endHour - startHour;
  const position = (date: Date) =>
    `${(((date.getHours() + date.getMinutes() / 60 - startHour) / span) * 100).toFixed(2)}%`;
  const hourMarks = Array.from({ length: Math.floor(span / 2) + 1 }, (_, i) => startHour + i * 2);
  const nowIsInside =
    now !== null && now.getHours() + now.getMinutes() / 60 >= startHour && now.getHours() < endHour;

  return (
    <div className="pt-6">
      <div className="bg-muted relative h-28 rounded-xl bg-[repeating-linear-gradient(90deg,var(--color-border)_0_1px,transparent_1px_calc(100%/12))]">
        {now && nowIsInside && (
          <>
            <div
              aria-hidden
              className="bg-background/55 absolute inset-y-0 left-0 rounded-l-xl"
              style={{ width: position(now) }}
            />
            <div
              aria-hidden
              className="bg-primary absolute -top-1.5 -bottom-1.5 w-0.5 rounded-full"
              style={{ left: position(now) }}
            >
              <span className="text-primary bg-background absolute -top-5 left-1/2 -translate-x-1/2 rounded px-1 font-mono text-[11px] font-medium">
                {format(now, "HH:mm")}
              </span>
            </div>
          </>
        )}
        {events.map((event) => {
          const isPast = now !== null && event.at < now && !event.reservation.isOverdue;
          return (
            <Link
              key={`${event.kind}-${event.reservation.id}`}
              href={getReservationDetailHref(
                event.reservation.id,
                event.kind === "departure" ? "home_departure" : "home_return",
              )}
              className={cn(
                "bg-card shadow-raised hover:shadow-overlay absolute flex -translate-x-1/2 items-center gap-1.5 rounded-full py-1 ps-1 pe-2.5 text-xs font-semibold whitespace-nowrap transition-shadow",
                event.reservation.isOverdue && "ring-destructive ring-[1.5px]",
                isPast && "opacity-55",
              )}
              style={{ left: position(event.at), top: `${8 + event.lane * 32}px` }}
            >
              <span
                className={cn(
                  "flex size-4.5 items-center justify-center rounded-full text-white",
                  event.reservation.isOverdue
                    ? "bg-destructive"
                    : event.kind === "departure"
                      ? "bg-success"
                      : "bg-primary",
                )}
              >
                {event.kind === "departure" ? (
                  <ArrowUpRight className="size-3" strokeWidth={3} />
                ) : (
                  <ArrowDownRight className="size-3" strokeWidth={3} />
                )}
              </span>
              {event.reservation.customer.firstName}
            </Link>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-1.5 flex justify-between px-0.5 font-mono text-[11px]">
        {hourMarks.map((hour) => (
          <span key={hour}>{hour}h</span>
        ))}
      </div>
    </div>
  );
};

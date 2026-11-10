"use client";

import { toZonedTime } from "date-fns-tz";
import { useFormatter, useTranslations } from "next-intl";

import { Tooltip, TooltipContent, TooltipTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

import type { DayAgenda } from "@/lib/dashboard/util.day-agenda";

import type { HomeCalendarDay, HomeReservation } from "./home-types";
import { WeekDayPreview } from "./week-day-preview";

interface WeekDayButtonProps {
  day: HomeCalendarDay;
  index: number;
  isToday: boolean;
  isSelected: boolean;
  isLoading: boolean;
  /** The day's agenda for its preview, or null while it loads. */
  agenda: DayAgenda<HomeReservation> | null;
  timeZone: string;
  onSelect: (date: Date) => void;
}

/**
 * One day of the home's week calendar: its name, its number, its hand-overs
 * and returns; hovered, a preview of them; picked, its agenda in the card.
 */
export const WeekDayButton = ({
  day,
  index,
  isToday,
  isSelected,
  isLoading,
  agenda,
  timeZone,
  onSelect,
}: WeekDayButtonProps) => {
  const t = useTranslations("dashboard.home");
  const format = useFormatter();
  const weekday = toZonedTime(day.date, timeZone).getDay();
  const isWeekend = weekday === 0 || weekday === 6;
  const busy = day.departures + day.returns > 0;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => onSelect(day.date)}
            aria-pressed={isSelected}
            aria-label={[
              format.dateTime(day.date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone,
              }),
              day.departures > 0 ? t("upcoming.departures", { count: day.departures }) : null,
              day.returns > 0 ? t("upcoming.returns", { count: day.returns }) : null,
            ]
              .filter(Boolean)
              .join(", ")}
            className={cn(
              "hover:bg-accent focus-visible:ring-ring relative flex flex-col items-center gap-1 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
              index > 0 && "border-s",
              isWeekend && "bg-muted/60",
              isToday && "bg-primary/10",
              isSelected && "bg-card shadow-[inset_0_-2px_0_var(--color-primary)]",
            )}
          />
        }
      >
        <span
          className={cn(
            "text-[10px] font-medium uppercase",
            isToday || isSelected ? "text-primary" : "text-muted-foreground",
          )}
        >
          {format.dateTime(day.date, { weekday: "short", timeZone })}
        </span>
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
            isToday && "bg-primary text-primary-foreground",
          )}
        >
          {format.dateTime(day.date, { day: "numeric", timeZone })}
        </span>
        <span className="flex h-4 items-center gap-1 font-mono text-[10px] font-semibold tabular-nums">
          {isLoading ? (
            <span aria-hidden className="bg-border h-1.5 w-5 animate-pulse rounded-full" />
          ) : (
            <>
              {day.departures > 0 && <span className="text-success">↗{day.departures}</span>}
              {day.returns > 0 && <span className="text-primary">↙{day.returns}</span>}
              {!busy && <span aria-hidden className="bg-border size-1 rounded-full" />}
            </>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <WeekDayPreview day={day} agenda={agenda} timeZone={timeZone} />
      </TooltipContent>
    </Tooltip>
  );
};

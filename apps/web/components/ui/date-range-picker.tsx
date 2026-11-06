"use client";

import { useState } from "react";

import { CalendarRange } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Calendar, Popover, PopoverPopup, PopoverTrigger } from "@louez/ui";
import { cn } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  dateToDay,
  dayToDate,
  formatDayRange,
  getSelectableDayBounds,
  orderDayRange,
  type DayRange,
} from "@/lib/utils/util.day-range";

interface DateRangePickerProps {
  /** Both days inclusive, as `yyyy-MM-dd`. `null` shows the placeholder. */
  value: DayRange | null;
  onChange: (value: DayRange) => void;
  /** "Today" where the dates are read — a store's day, not always the browser's. */
  today?: string;
  /** Earliest and latest selectable days. */
  minDay?: string;
  maxDay?: string;
  /** Longest selectable range, in days. */
  maxDays?: number;
  placeholder?: string;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Two clicks pick a range: the first day, then the last (in either order). The
 * value only changes once both are chosen, so whatever listens to it — a URL, a
 * query — never sees a half-made range.
 */
export const DateRangePicker = ({
  value,
  onChange,
  today,
  minDay,
  maxDay,
  maxDays,
  placeholder,
  align = "end",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: DateRangePickerProps) => {
  const t = useTranslations("common.dateRangePicker");
  const { dateFns: dateLocale } = useFormatLocale();
  const isWide = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  // The first click of a selection in progress; the range is still `value`.
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const currentDay = today ?? dateToDay(new Date());

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    setDraftStart(null);
  };

  const handleDayClick = (day: string) => {
    if (draftStart === null) {
      setDraftStart(day);
      return;
    }
    onChange(orderDayRange(draftStart, day));
    handleOpenChange(false);
  };

  // Once the first day is set, the range cap closes the days out of its reach.
  const { earliest, latest } = getSelectableDayBounds({
    anchor: draftStart,
    minDay,
    maxDay,
    maxDays,
  });

  const selected = draftStart
    ? { from: dayToDate(draftStart), to: undefined }
    : value
      ? { from: dayToDate(value.from), to: dayToDate(value.to) }
      : undefined;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            className={cn(
              "justify-start tabular-nums",
              !value && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarRange />
        {value ? formatDayRange(value, dateLocale, currentDay) : (placeholder ?? t("placeholder"))}
      </PopoverTrigger>
      <PopoverPopup align={align} className="w-auto">
        {/* `w-min` pins the width to the calendar, so the hint wraps instead of resizing the popup. */}
        <div className="flex w-min flex-col">
          <Calendar
            mode="range"
            numberOfMonths={isWide ? 2 : 1}
            selected={selected}
            onSelect={(_, day) => handleDayClick(dateToDay(day))}
            defaultMonth={dayToDate(value?.from ?? currentDay)}
            today={dayToDate(currentDay)}
            disabled={[
              ...(earliest ? [{ before: dayToDate(earliest) }] : []),
              ...(latest ? [{ after: dayToDate(latest) }] : []),
            ]}
            locale={dateLocale}
          />
          <div className="text-muted-foreground flex min-h-8 items-center justify-between gap-3 border-t px-2 pt-2 text-xs">
            <span>{draftStart === null ? t("pickStart") : t("pickEnd")}</span>
            {maxDays && <span className="shrink-0">{t("maxDays", { count: maxDays })}</span>}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
};

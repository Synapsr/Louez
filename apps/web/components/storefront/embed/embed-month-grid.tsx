"use client";

import { useId, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Locale } from "date-fns";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

interface EmbedMonthGridProps {
  month: Date;
  onMonthChange: (month: Date) => void;
  locale: Locale;
  /** Months before this one cannot be reached. */
  minDate: Date;
  isDisabled: (day: Date) => boolean;
  value?: Date;
  onSelect: (day: Date) => void;
}

const WEEKS_PER_GRID = 6;
const monthTransition = { duration: 0.24, ease: [0.19, 1, 0.22, 1] } as const;
const capTransition = { type: "spring", duration: 0.3, bounce: 0 } as const;

/**
 * One month, one pick. Drawn by hand rather than through the shared
 * calendar so the embed can keep a fixed six-row height (a month change
 * never moves the CTA under it), slide months in the direction of travel
 * and glide the selected cap from one day to the next.
 */
export const EmbedMonthGrid = ({
  month,
  onMonthChange,
  locale,
  minDate,
  isDisabled,
  value,
  onSelect,
}: EmbedMonthGridProps) => {
  const t = useTranslations("storefront.embed");
  const id = useId();
  const reduceMotion = useReducedMotion();
  const [direction, setDirection] = useState(1);

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { locale });
    const list = eachDayOfInterval({ start: first, end: endOfWeek(endOfMonth(month), { locale }) });
    while (list.length < WEEKS_PER_GRID * 7) list.push(addDays(list.at(-1) ?? first, 1));
    return list;
  }, [month, locale]);

  const weekdays = useMemo(
    () =>
      days
        .slice(0, 7)
        .map((day) => ({ key: day.getDay(), label: format(day, "EEEEE", { locale }) })),
    [days, locale],
  );

  const goTo = (delta: number) => {
    setDirection(delta);
    onMonthChange(addMonths(month, delta));
  };
  const canGoBack = isAfter(startOfMonth(month), startOfMonth(minDate));
  const monthKey = format(month, "yyyy-MM");
  const slide = reduceMotion ? 0 : 20;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => goTo(-1)}
          disabled={!canGoBack}
          aria-label={t("previousMonth")}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <div className="relative h-6 flex-1 overflow-hidden text-center text-sm font-semibold capitalize">
          <AnimatePresence initial={false} mode="popLayout" custom={direction}>
            <motion.span
              key={monthKey}
              custom={direction}
              initial={{ opacity: 0, x: (slide / 2) * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: (-slide / 2) * direction }}
              transition={monthTransition}
              className="absolute inset-0"
            >
              {format(month, "MMMM yyyy", { locale })}
            </motion.span>
          </AnimatePresence>
        </div>
        <button
          type="button"
          onClick={() => goTo(1)}
          aria-label={t("nextMonth")}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {weekdays.map((weekday) => (
          <span key={weekday.key} className="py-1">
            {weekday.label}
          </span>
        ))}
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={monthKey}
            custom={direction}
            initial={{ opacity: 0, x: slide * direction }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -slide * direction }}
            transition={monthTransition}
            className="grid grid-cols-7 gap-y-0.5"
          >
            {days.map((day) => {
              const outside = !isSameMonth(day, month);
              const disabled = isDisabled(day);
              const selected = Boolean(value && isSameDay(day, value));
              const today = isToday(day);
              return (
                <div key={day.toISOString()} className="relative h-9">
                  {selected ? (
                    <motion.span
                      layoutId={`${id}-cap`}
                      transition={reduceMotion ? { duration: 0 } : capTransition}
                      aria-hidden
                      className="absolute inset-0.5 rounded-full bg-primary"
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(day)}
                    aria-label={format(day, "EEEE d MMMM", { locale })}
                    aria-pressed={selected}
                    className={cn(
                      "relative z-10 flex size-full items-center justify-center rounded-full text-sm tabular-nums transition-[color,transform] duration-150 active:scale-95",
                      outside && "text-muted-foreground/50",
                      disabled &&
                        "cursor-not-allowed text-muted-foreground/40 line-through decoration-muted-foreground/40",
                      !disabled && !selected && "hover:bg-primary/10",
                      selected && "font-semibold text-primary-foreground",
                      today && !selected && "font-semibold text-primary",
                    )}
                  >
                    {format(day, "d")}
                    {today && !selected ? (
                      <span
                        aria-hidden
                        className="absolute bottom-1 size-1 rounded-full bg-primary"
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

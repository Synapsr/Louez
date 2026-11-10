"use client";

import { useEffect, useRef, useState } from "react";

import { AnimatePresence, motion, type PanInfo, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, TooltipProvider } from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import type { DayAgenda } from "@/lib/dashboard/util.day-agenda";
import { resolveStoreTimezone, storeDayKey } from "@/lib/dashboard/util.store-day";

import type { HomeCalendarDay, HomeReservation } from "./home-types";
import { WeekDayButton } from "./week-day-button";

/** How far a drag has to go, in pixels, or how fast, to turn the week. */
const SWIPE_DISTANCE = 48;
const SWIPE_VELOCITY = 400;
/** Horizontal trackpad travel that turns the week, in pixels. */
const WHEEL_DISTANCE = 40;
/** Quiet time that ends a trackpad gesture, so its inertia turns one week only. */
const WHEEL_GESTURE_END_MS = 180;

type Direction = -1 | 1;

interface HomeWeekCalendarProps {
  /** Seven consecutive days, from the first one shown. */
  days: HomeCalendarDay[];
  todayKey: string;
  selectedKey: string;
  onSelect: (date: Date) => void;
  onPrevious: () => void;
  onNext: () => void;
  /** The week's counts are still on their way. */
  isLoading?: boolean;
  /** A day's agenda for its hover preview, or null while it loads. */
  getAgenda: (date: Date) => DayAgenda<HomeReservation> | null;
  /** The pointer or focus reached the week: time to load what the previews need. */
  onPreview: () => void;
}

/**
 * A week of days drawn like the reservations calendar's day row, with each
 * day's hand-overs and returns. It turns a week at a time — arrows, a swipe
 * or a drag, a two-finger swipe on a trackpad — and slides the way it goes.
 * A day, once picked, shows its agenda in the card below; hovered, it
 * previews its first hand-overs and returns.
 */
export const HomeWeekCalendar = ({
  days,
  todayKey,
  selectedKey,
  onSelect,
  onPrevious,
  onNext,
  isLoading = false,
  getAgenda,
  onPreview,
}: HomeWeekCalendarProps) => {
  const t = useTranslations("dashboard.home");
  const timeZone = resolveStoreTimezone(useStore().timezone);
  const reduceMotion = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  // A drag ends with a click on the day under the pointer: that one is not a pick.
  const draggedRef = useRef(false);

  const turn = (to: Direction) => {
    if (to < 0) onPrevious();
    else onNext();
  };
  const turnRef = useRef(turn);
  turnRef.current = turn;

  // Trackpads: a horizontal two-finger swipe turns the week, once per gesture.
  // Native listener, as React's wheel events can't stop the browser's own
  // back/forward swipe.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let travel = 0;
    let turned = false;
    let gestureEnd: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      window.clearTimeout(gestureEnd);
      gestureEnd = window.setTimeout(() => {
        travel = 0;
        turned = false;
      }, WHEEL_GESTURE_END_MS);
      if (turned) return;
      travel += event.deltaX;
      if (Math.abs(travel) >= WHEEL_DISTANCE) {
        turned = true;
        turnRef.current(travel > 0 ? 1 : -1);
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      window.clearTimeout(gestureEnd);
    };
  }, []);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
    if (info.offset.x <= -SWIPE_DISTANCE || info.velocity.x <= -SWIPE_VELOCITY) turn(1);
    else if (info.offset.x >= SWIPE_DISTANCE || info.velocity.x >= SWIPE_VELOCITY) turn(-1);
  };

  const weekKey = days[0] ? storeDayKey(days[0].date, timeZone) : "";
  // The week slides the way it went — arrows, swipe, or a jump to a far day.
  const [shown, setShown] = useState<{ key: string; direction: Direction }>({
    key: weekKey,
    direction: 1,
  });
  if (shown.key !== weekKey) {
    setShown({ key: weekKey, direction: weekKey > shown.key ? 1 : -1 });
  }
  const { direction } = shown;

  return (
    <div className="flex shrink-0 items-stretch gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => turn(-1)}
        aria-label={t("today.week.previous")}
        title={t("today.week.previous")}
        className="text-muted-foreground h-auto"
      >
        <ChevronLeft />
      </Button>
      <div
        ref={viewportRef}
        role="group"
        aria-label={t("today.week.label")}
        onPointerEnter={onPreview}
        onFocus={onPreview}
        className="bg-muted/40 relative min-w-0 flex-1 overflow-hidden rounded-xl border overscroll-x-contain"
      >
        <TooltipProvider>
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={weekKey}
              custom={direction}
              variants={{
                enter: (from: Direction) => ({ x: `${from * 100}%`, opacity: 0.4 }),
                center: { x: 0, opacity: 1 },
                exit: (from: Direction) => ({ x: `${from * -100}%`, opacity: 0.4 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={
                reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 40 }
              }
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.35}
              onDragStart={() => {
                draggedRef.current = true;
              }}
              onDragEnd={handleDragEnd}
              onClickCapture={(event) => {
                if (!draggedRef.current) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              className="grid grid-cols-7 select-none"
            >
              {days.map((day, index) => {
                const key = storeDayKey(day.date, timeZone);
                return (
                  <WeekDayButton
                    key={key}
                    day={day}
                    index={index}
                    isToday={key === todayKey}
                    isSelected={key === selectedKey}
                    isLoading={isLoading}
                    agenda={getAgenda(day.date)}
                    timeZone={timeZone}
                    onSelect={onSelect}
                  />
                );
              })}
            </motion.div>
          </AnimatePresence>
        </TooltipProvider>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => turn(1)}
        aria-label={t("today.week.next")}
        title={t("today.week.next")}
        className="text-muted-foreground h-auto"
      >
        <ChevronRight />
      </Button>
    </div>
  );
};

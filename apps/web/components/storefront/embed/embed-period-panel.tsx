"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

import { EmbedCollapse } from "./embed-collapse";
import { EmbedMonthGrid } from "./embed-month-grid";
import { EmbedTimeGrid } from "./embed-time-grid";
import type { EmbedPeriod } from "./use-embed-period";
import { embedStepField, embedStepPart, type EmbedPeriodStep } from "./util.embed-period-steps";

interface EmbedPeriodPanelProps {
  period: EmbedPeriod;
  slotIntervalMinutes: number;
}

/** Where the caret sits under the fields row, as a fraction of its width. */
const CARET_LEFT: Record<EmbedPeriodStep, string> = {
  startDate: "16%",
  startTime: "40%",
  endDate: "66%",
  endTime: "90%",
};

const caretTransition = { type: "spring", duration: 0.35, bounce: 0 } as const;

/**
 * The editor that unfolds under the fields: a caret pointing at the half
 * being edited, then a month for a day or the day's slots for a time.
 */
export const EmbedPeriodPanel = ({ period, slotIntervalMinutes }: EmbedPeriodPanelProps) => {
  const t = useTranslations("storefront.embed");
  const reduceMotion = useReducedMotion();
  const { core, editing, shownStep } = period;
  const field = embedStepField(shownStep);

  return (
    <EmbedCollapse open={editing.active !== null} contentKey={shownStep}>
      <div className="relative pt-4">
        <motion.span
          aria-hidden
          animate={{ left: CARET_LEFT[shownStep] }}
          transition={reduceMotion ? { duration: 0 } : caretTransition}
          className="absolute top-2.5 size-3 -translate-x-1/2 rotate-45 rounded-[2px] border-t border-l bg-background"
        />
        <div className="flex flex-col gap-2 rounded-xl border bg-background p-3">
          <p className="text-center text-xs font-medium text-muted-foreground">
            {t(`steps.${shownStep}`)}
          </p>
          {embedStepPart(shownStep) === "date" ? (
            <EmbedMonthGrid
              month={period.month}
              onMonthChange={period.setMonth}
              locale={period.dateFns}
              minDate={core.minDate}
              isDisabled={(day) => period.isDayDisabled(shownStep, day)}
              value={field === "start" ? core.startDate : core.endDate}
              onSelect={period.pickDay}
            />
          ) : (
            <EmbedTimeGrid
              slots={field === "start" ? core.startTimeSlots : core.endTimeSlots}
              intervalMinutes={slotIntervalMinutes}
              value={field === "start" ? core.startTime : core.endTime}
              onSelect={period.pickTime}
            />
          )}
        </div>
      </div>
    </EmbedCollapse>
  );
};

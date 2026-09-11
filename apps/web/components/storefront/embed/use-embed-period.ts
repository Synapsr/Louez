"use client";

import { useCallback, useMemo, useState } from "react";
import { format, isSameDay, startOfDay, startOfMonth } from "date-fns";

import { useRentalDateCore } from "@/components/storefront/date-picker/core/use-rental-date-core";
import { usePeriodIssueMessage } from "@/components/storefront/date-picker/use-period-issue-message";
import { useFormatLocale } from "@/hooks/use-format-locale";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import {
  FOLDED_EMBED_PERIOD,
  embedStepField,
  resolveEmbedPeriodPick,
  resolveEmbedPeriodTap,
  type EmbedPeriodEditing,
  type EmbedPeriodStep,
} from "./util.embed-period-steps";

/**
 * The embed widget's state: the period draft (`useRentalDateCore`) plus
 * which half is being edited. The first fill is guided (each pick hands
 * over to the next half); afterwards a tap edits one half and folds.
 */
export const useEmbedPeriod = (rules: RentalPeriodRules) => {
  const { dateFns } = useFormatLocale();
  const issueMessage = usePeriodIssueMessage();
  const core = useRentalDateCore({
    pricingMode: rules.pricingMode,
    minRentalMinutes: rules.minRentalMinutes ?? 60,
    maxRentalMinutes: rules.maxRentalMinutes,
    businessHours: rules.businessHours,
    advanceNoticeMinutes: rules.advanceNoticeMinutes,
    timezone: rules.timezone,
  });

  const [editing, setEditing] = useState<EmbedPeriodEditing>(FOLDED_EMBED_PERIOD);
  // What the panel shows while it folds, so the content does not vanish mid-animation.
  const [lastStep, setLastStep] = useState<EmbedPeriodStep>("startDate");
  const [month, setMonth] = useState(() => startOfMonth(core.minDate));

  const { startDate, endDate, minDate, hasDates } = core;

  const open = useCallback(
    (next: EmbedPeriodEditing) => {
      setEditing(next);
      if (!next.active) return;
      setLastStep(next.active);
      const anchor = embedStepField(next.active) === "end" ? endDate : startDate;
      setMonth(startOfMonth(anchor ?? minDate));
    },
    [startDate, endDate, minDate],
  );

  const tap = useCallback(
    (step: EmbedPeriodStep) => open(resolveEmbedPeriodTap(editing, step, hasDates)),
    [editing, hasDates, open],
  );

  const fold = useCallback(() => setEditing(FOLDED_EMBED_PERIOD), []);

  /** The pickup day alone: the return stays when it is still after, the time when the day still offers it. */
  const setStartDay = useCallback(
    (day: Date) => {
      const start = startOfDay(day);
      const keepEnd =
        endDate &&
        (endDate > start || (isSameDay(endDate, start) && core.endTime > core.startTime));
      if (keepEnd) core.selectDays(start, endDate);
      else core.selectStartDate(start);
    },
    [core, endDate],
  );

  const pickDay = useCallback(
    (day: Date) => {
      if (!editing.active) return;
      if (embedStepField(editing.active) === "start") setStartDay(day);
      else core.selectEndDate(startOfDay(day));
      open(resolveEmbedPeriodPick(editing));
    },
    [editing, core, setStartDay, open],
  );

  const pickTime = useCallback(
    (time: string) => {
      if (!editing.active) return;
      if (embedStepField(editing.active) === "start") core.setStartTime(time);
      else core.setEndTime(time);
      open(resolveEmbedPeriodPick(editing));
    },
    [editing, core, open],
  );

  /** Calendar floor for the open step: the return cannot land before the pickup. */
  const isDayDisabled = useCallback(
    (step: EmbedPeriodStep, day: Date): boolean =>
      core.isDateDisabled(day) ||
      (embedStepField(step) === "end" && Boolean(startDate && day < startOfDay(startDate))),
    [core, startDate],
  );

  const labels = useMemo(() => {
    const short = (value?: Date) => (value ? format(value, "d MMM", { locale: dateFns }) : null);
    const compact = (value?: Date) => (value ? format(value, "dd/MM", { locale: dateFns }) : null);
    return {
      startDay: short(startDate),
      endDay: short(endDate),
      startDayCompact: compact(startDate),
      endDayCompact: compact(endDate),
    };
  }, [startDate, endDate, dateFns]);

  const message = hasDates ? issueMessage(core.validation) : null;

  return {
    core,
    editing,
    shownStep: editing.active ?? lastStep,
    month,
    setMonth,
    tap,
    fold,
    pickDay,
    pickTime,
    isDayDisabled,
    labels,
    message,
    dateFns,
  };
};

export type EmbedPeriod = ReturnType<typeof useEmbedPeriod>;

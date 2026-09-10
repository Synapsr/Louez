import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";

import {
  validateRentalPeriodSelection,
  type RentalPeriodRules,
} from "@/lib/utils/util.rental-period";
import type { RentalDateDraft } from "./core/types";
import { buildDateTimeRange, getRentalDraftForDay } from "./core/use-rental-date-core";

export const buildCalendarAvailabilityCandidates = ({
  core,
  rules,
  month,
  months,
}: {
  core: RentalDateDraft & { isDateDisabled: (day: Date) => boolean };
  rules: RentalPeriodRules;
  month: Date;
  months: number;
}) => {
  return eachDayOfInterval({
    start: startOfMonth(month),
    end: endOfMonth(addMonths(month, months - 1)),
  }).flatMap((day) => {
    if (core.isDateDisabled(day)) return [];
    const draft = getRentalDraftForDay(core, day, {
      ...rules,
      minRentalMinutes: rules.minRentalMinutes ?? 60,
      advanceNoticeMinutes: rules.advanceNoticeMinutes ?? 0,
      intervalMinutes: 30,
    });
    if (!draft.startDate || !draft.endDate) return [];
    const period = buildDateTimeRange({
      startDate: draft.startDate,
      endDate: draft.endDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      timezone: rules.timezone,
    });
    if (!validateRentalPeriodSelection({ ...period, rules }).ok) return [];
    return [
      {
        day: format(day, "yyyy-MM-dd"),
        startDate: period.start.toISOString(),
        endDate: period.end.toISOString(),
      },
    ];
  });
};

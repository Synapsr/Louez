"use client";

import { useCallback, useMemo, useState } from "react";
import { addDays, isSameDay as isSameCalendarDay, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import type { BusinessHours, PricingMode } from "@louez/types";

import {
  buildStoreDate,
  generateTimeSlots,
  getAvailableTimeSlots,
  getNextAvailableDate,
  isDateAvailable,
} from "@/lib/utils/business-hours";
import { getMinStartDate, getMinStartDateTime } from "@/lib/utils/duration";
import {
  allowsSameDayRental,
  validateRentalPeriodSelection,
  type RentalPeriodRules,
} from "@/lib/utils/util.rental-period";

import type {
  RentalDateCoreOptions,
  RentalDateCoreState,
  RentalDateDraft,
  RentalPeriodField,
  RentalPeriodValue,
  TimeRangeBuildOptions,
} from "./types";

export { allowsSameDayRental };

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "18:00";
const DEFAULT_INTERVAL_MINUTES = 30;

// ─── Pure helpers (also used by the product preview modal) ─────────────────

export const applyTimeToDate = (date: Date, time: string): Date => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
};

export const getTimeFromDate = (date?: Date): string | undefined => {
  if (!date) return undefined;
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

export const isCalendarDateBeforeSelectedDate = (date: Date, selectedDate?: Date): boolean =>
  selectedDate ? date < startOfDay(selectedDate) : false;

/** Keeps `current` when it is still offered, else the first or last slot. */
export const ensureSelectedTime = (
  current: string,
  slots: string[],
  fallback: "first" | "last" = "first",
): string => {
  if (slots.length === 0 || slots.includes(current)) return current;
  const fallbackSlot = fallback === "last" ? slots[slots.length - 1] : slots[0];
  return fallbackSlot ?? current;
};

export const createTimeSlots = (
  start: string,
  end: string,
  intervalMinutes = DEFAULT_INTERVAL_MINUTES,
): string[] => generateTimeSlots(start, end, intervalMinutes);

export const buildDateTimeRange = ({
  startDate,
  endDate,
  startTime,
  endTime,
  timezone,
}: TimeRangeBuildOptions): RentalPeriodValue => ({
  start: buildStoreDate(startDate, startTime, timezone),
  end: buildStoreDate(endDate, endTime, timezone),
});

export const isSameDayEndTimeSlotAllowed = ({
  startDate,
  startTime,
  endDate,
  endTime,
  minRentalMinutes = 0,
  timezone,
}: {
  startDate: Date;
  startTime: string;
  endDate: Date;
  endTime: string;
  minRentalMinutes?: number;
  timezone?: string;
}): boolean => {
  const { start, end } = buildDateTimeRange({ startDate, endDate, startTime, endTime, timezone });
  if (minRentalMinutes > 0) {
    return end.getTime() >= start.getTime() + minRentalMinutes * 60 * 1000;
  }
  return end.getTime() > start.getTime();
};

/** Same day when the store allows it, else the next open day (decision 7). */
export const getDefaultEndDateForStartDate = ({
  startDate,
  pricingMode,
  minRentalMinutes = 0,
  businessHours,
  timezone,
}: {
  startDate: Date;
  pricingMode: PricingMode;
  minRentalMinutes?: number;
  businessHours?: BusinessHours;
  timezone?: string;
}): Date => {
  if (allowsSameDayRental(pricingMode, minRentalMinutes)) return startDate;
  const nextDay = addDays(startDate, 1);
  return getNextAvailableDate(nextDay, businessHours, 365, timezone) ?? nextDay;
};

/** Splits an instant into the store's calendar day (local midnight) and wall-clock time. */
export const splitStoreDateTime = (
  value: Date | string | null | undefined,
  timezone?: string,
): { day: Date; time: string } | undefined => {
  if (!value) return undefined;
  const instant = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) return undefined;
  const wallClock = timezone ? toZonedTime(instant, timezone) : instant;
  return { day: startOfDay(wallClock), time: getTimeFromDate(wallClock) ?? DEFAULT_START_TIME };
};

interface SlotContext {
  businessHours?: BusinessHours;
  intervalMinutes: number;
  timezone?: string;
  advanceNoticeMinutes: number;
  minRentalMinutes: number;
}

const getStartSlots = (day: Date, ctx: SlotContext): string[] => {
  const earliest = getMinStartDateTime(ctx.advanceNoticeMinutes);
  return getAvailableTimeSlots(day, ctx.businessHours, ctx.intervalMinutes, ctx.timezone).filter(
    (slot) => buildStoreDate(day, slot, ctx.timezone) >= earliest,
  );
};

const getEndSlots = (
  endDay: Date,
  startDay: Date | undefined,
  startTime: string,
  ctx: SlotContext,
): string[] => {
  const slots = getAvailableTimeSlots(endDay, ctx.businessHours, ctx.intervalMinutes, ctx.timezone);
  if (!startDay || !isSameCalendarDay(startDay, endDay)) return slots;
  return slots.filter((slot) =>
    isSameDayEndTimeSlotAllowed({
      startDate: startDay,
      startTime,
      endDate: endDay,
      endTime: slot,
      minRentalMinutes: ctx.minRentalMinutes,
      timezone: ctx.timezone,
    }),
  );
};

// ─── Draft transitions (pure) ───────────────────────────────────────────────

interface DraftContext extends SlotContext {
  pricingMode: PricingMode;
}

/** Start a fresh range on `day`; the end follows the default rule and the times snap to open slots. */
const beginRange = (draft: RentalDateDraft, day: Date, ctx: DraftContext): RentalDateDraft => {
  const endDate = getDefaultEndDateForStartDate({
    startDate: day,
    pricingMode: ctx.pricingMode,
    minRentalMinutes: ctx.minRentalMinutes,
    businessHours: ctx.businessHours,
    timezone: ctx.timezone,
  });
  const startTime = ensureSelectedTime(draft.startTime, getStartSlots(day, ctx), "first");
  const endTime = ensureSelectedTime(
    draft.endTime,
    getEndSlots(endDate, day, startTime, ctx),
    "last",
  );
  return { ...draft, startDate: day, endDate, startTime, endTime, endIsAuto: true };
};

const endRange = (draft: RentalDateDraft, day: Date, ctx: DraftContext): RentalDateDraft => {
  const endTime = ensureSelectedTime(
    draft.endTime,
    getEndSlots(day, draft.startDate, draft.startTime, ctx),
    "last",
  );
  return { ...draft, endDate: day, endTime, endIsAuto: false };
};

const withStartTime = (
  draft: RentalDateDraft,
  time: string,
  ctx: DraftContext,
): RentalDateDraft => {
  if (!draft.endDate) return { ...draft, startTime: time };
  const endTime = ensureSelectedTime(
    draft.endTime,
    getEndSlots(draft.endDate, draft.startDate, time, ctx),
    "last",
  );
  return { ...draft, startTime: time, endTime };
};

export const getRentalDraftForDay = (
  draft: RentalDateDraft,
  day: Date,
  ctx: DraftContext,
): RentalDateDraft => {
  const { startDate, endDate, endIsAuto, activeField } = draft;
  if (activeField === "end" && startDate) {
    if (day < startOfDay(startDate)) return draft;
    if (
      isSameCalendarDay(day, startDate) &&
      !allowsSameDayRental(ctx.pricingMode, ctx.minRentalMinutes)
    ) {
      return draft;
    }
    return { ...endRange(draft, day, ctx), activeField: null };
  }
  if (activeField) {
    const next = beginRange(draft, day, ctx);
    const canKeepEnd =
      endDate &&
      (endDate > day ||
        (isSameCalendarDay(endDate, day) &&
          allowsSameDayRental(ctx.pricingMode, ctx.minRentalMinutes)));
    return {
      ...(canKeepEnd ? endRange({ ...next, endTime: draft.endTime }, endDate, ctx) : next),
      activeField: "end",
    };
  }
  if (!startDate || !endIsAuto) return beginRange(draft, day, ctx);
  if (day < startOfDay(startDate)) return beginRange(draft, day, ctx);
  const sameDayTap = isSameCalendarDay(day, startDate);
  if (sameDayTap && !allowsSameDayRental(ctx.pricingMode, ctx.minRentalMinutes)) {
    return beginRange(draft, day, ctx);
  }
  return endRange(draft, day, ctx);
};

const initialDraft = (options: RentalDateCoreOptions): RentalDateDraft => {
  const start = splitStoreDateTime(options.initialStart, options.timezone);
  const end = splitStoreDateTime(options.initialEnd, options.timezone);
  return {
    startDate: start?.day,
    endDate: end?.day,
    startTime: start?.time ?? DEFAULT_START_TIME,
    endTime: end?.time ?? DEFAULT_END_TIME,
    endIsAuto: false,
    activeField: options.initialField ?? null,
  };
};

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * The whole period state machine: calendar days, times, open field, slot
 * corrections and validation. No effect syncs anything: each transition
 * corrects the times it invalidates.
 */
export const useRentalDateCore = (options: RentalDateCoreOptions): RentalDateCoreState => {
  const {
    pricingMode,
    minRentalMinutes,
    maxRentalMinutes,
    businessHours,
    advanceNoticeMinutes = 0,
    minDate: minDateFloor,
    timezone,
    intervalMinutes = DEFAULT_INTERVAL_MINUTES,
  } = options;

  const [draft, setDraft] = useState<RentalDateDraft>(() => initialDraft(options));
  const [previousInitialField, setPreviousInitialField] = useState(options.initialField);
  if (options.initialField !== previousInitialField) {
    setPreviousInitialField(options.initialField);
    setDraft((prev) => ({ ...prev, activeField: options.initialField ?? null }));
  }

  const ctx = useMemo<DraftContext>(
    () => ({
      pricingMode,
      minRentalMinutes,
      businessHours,
      advanceNoticeMinutes,
      timezone,
      intervalMinutes,
    }),
    [pricingMode, minRentalMinutes, businessHours, advanceNoticeMinutes, timezone, intervalMinutes],
  );

  const rules = useMemo<RentalPeriodRules>(
    () => ({
      pricingMode,
      businessHours,
      timezone,
      advanceNoticeMinutes,
      minRentalMinutes,
      maxRentalMinutes,
    }),
    [
      pricingMode,
      businessHours,
      timezone,
      advanceNoticeMinutes,
      minRentalMinutes,
      maxRentalMinutes,
    ],
  );

  const minDate = useMemo(() => {
    const noticeFloor = getMinStartDate(advanceNoticeMinutes);
    if (!minDateFloor) return noticeFloor;
    const floor = startOfDay(minDateFloor);
    return floor > noticeFloor ? floor : noticeFloor;
  }, [advanceNoticeMinutes, minDateFloor]);

  const { startDate, endDate, startTime, endTime } = draft;

  const isSameDay = Boolean(startDate && endDate && isSameCalendarDay(startDate, endDate));

  const startTimeSlots = useMemo(
    () =>
      startDate
        ? getStartSlots(startDate, ctx)
        : createTimeSlots("07:00", "21:00", intervalMinutes),
    [startDate, ctx, intervalMinutes],
  );

  const endTimeSlots = useMemo(
    () =>
      endDate
        ? getEndSlots(endDate, startDate, startTime, ctx)
        : createTimeSlots("07:00", "21:00", intervalMinutes),
    [endDate, startDate, startTime, ctx, intervalMinutes],
  );

  const isDateDisabled = useCallback(
    (date: Date): boolean => {
      if (date < minDate) return true;
      if (draft.activeField === "end" && startDate) {
        if (date < startOfDay(startDate)) return true;
        if (
          isSameCalendarDay(date, startDate) &&
          !allowsSameDayRental(pricingMode, minRentalMinutes)
        ) {
          return true;
        }
      }
      if (!businessHours?.enabled) return false;
      return !isDateAvailable(date, businessHours, timezone).available;
    },
    [minDate, businessHours, timezone, draft.activeField, startDate, pricingMode, minRentalMinutes],
  );

  const period = useMemo<RentalPeriodValue | null>(
    () =>
      startDate && endDate
        ? buildDateTimeRange({ startDate, endDate, startTime, endTime, timezone })
        : null,
    [startDate, endDate, startTime, endTime, timezone],
  );

  const validation = useMemo(
    () => validateRentalPeriodSelection({ start: period?.start, end: period?.end, rules }),
    [period, rules],
  );

  const openField = useCallback((field: RentalPeriodField) => {
    setDraft((prev) => ({ ...prev, activeField: field }));
  }, []);

  const closeField = useCallback(() => {
    setDraft((prev) => (prev.activeField ? { ...prev, activeField: null } : prev));
  }, []);

  const selectDay = useCallback(
    (day: Date) => setDraft((prev) => getRentalDraftForDay(prev, startOfDay(day), ctx)),
    [ctx],
  );

  const selectStartDate = useCallback(
    (day: Date) => setDraft((prev) => beginRange(prev, startOfDay(day), ctx)),
    [ctx],
  );

  const selectEndDate = useCallback(
    (day: Date) => setDraft((prev) => endRange(prev, startOfDay(day), ctx)),
    [ctx],
  );

  const selectDays = useCallback(
    (startDay: Date, endDay: Date) =>
      setDraft((prev) =>
        endRange(beginRange(prev, startOfDay(startDay), ctx), startOfDay(endDay), ctx),
      ),
    [ctx],
  );

  const setStartTime = useCallback(
    (time: string) => setDraft((prev) => withStartTime(prev, time, ctx)),
    [ctx],
  );

  const setEndTime = useCallback((time: string) => {
    setDraft((prev) => ({ ...prev, endTime: time }));
  }, []);

  const clear = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      startDate: undefined,
      endDate: undefined,
      endIsAuto: false,
    }));
  }, []);

  const buildFinalRange = useCallback(() => (validation.ok ? period : null), [validation, period]);

  return {
    ...draft,
    hasDates: Boolean(startDate && endDate),
    isSameDay,
    minDate,
    startTimeSlots,
    endTimeSlots,
    isDateDisabled,
    openField,
    closeField,
    selectDay,
    selectStartDate,
    selectEndDate,
    selectDays,
    setStartTime,
    setEndTime,
    clear,
    period,
    validation,
    canSubmit: validation.ok,
    buildFinalRange,
  };
};

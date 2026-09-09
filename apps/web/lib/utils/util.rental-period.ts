import { addDays, startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { BusinessHours, PricingMode } from "@louez/types";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

import { getNextAvailableDate } from "@/lib/utils/business-hours";
import { getMinStartDate } from "@/lib/utils/duration";
import { getMinRentalMinutes } from "@/lib/utils/rental-duration";
import { evaluateReservationRules } from "@/lib/utils/reservation-rules";

const DAY_MINUTES = 24 * 60;

/** The store rules a period must satisfy. Mirrors the server checks. */
export interface RentalPeriodRules {
  pricingMode: PricingMode;
  businessHours?: BusinessHours;
  timezone?: string;
  advanceNoticeMinutes?: number;
  /** Minutes; `undefined` falls back to the store default (60). */
  minRentalMinutes?: number;
  /** Minutes; `null` or `undefined` = no limit. */
  maxRentalMinutes?: number | null;
}

export type RentalPeriodIssue =
  | { code: "missing_dates" }
  | { code: "end_before_start" }
  | { code: "same_day_not_allowed" }
  | { code: "business_hours" }
  | { code: "advance_notice"; duration: string }
  | { code: "min_duration"; duration: string }
  | { code: "max_duration"; duration: string };

export type RentalPeriodValidation = { ok: true } | { ok: false; issue: RentalPeriodIssue };

/** Same-day rentals need hourly pricing or a minimum under a day. */
export const allowsSameDayRental = (pricingMode: PricingMode, minRentalMinutes: number): boolean =>
  pricingMode === "hour" || minRentalMinutes < DAY_MINUTES;

const toStoreDayKey = (date: Date, timezone?: string): string =>
  timezone ? formatInTimeZone(date, timezone, "yyyy-MM-dd") : startOfDay(date).toISOString();

/** Two instants fall on the same calendar day of the store. */
export const isSameStoreDay = (start: Date, end: Date, timezone?: string): boolean =>
  toStoreDayKey(start, timezone) === toStoreDayKey(end, timezone);

const durationOf = (params: Record<string, string | number> | undefined): string =>
  String(params?.duration ?? "");

/**
 * Client-side mirror of the reservation window rules: order, end after
 * start, same-day policy, then opening hours, advance notice, minimum and
 * maximum duration through `evaluateReservationRules` (the server's list).
 * The first failing rule is returned so the UI shows one line.
 */
export const validateRentalPeriodSelection = ({
  start,
  end,
  rules,
}: {
  start: Date | undefined;
  end: Date | undefined;
  rules: RentalPeriodRules;
}): RentalPeriodValidation => {
  if (!start || !end) {
    return { ok: false, issue: { code: "missing_dates" } };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, issue: { code: "end_before_start" } };
  }

  const minRentalMinutes = getMinRentalMinutes(rules);
  if (
    !allowsSameDayRental(rules.pricingMode, minRentalMinutes) &&
    isSameStoreDay(start, end, rules.timezone)
  ) {
    return { ok: false, issue: { code: "same_day_not_allowed" } };
  }

  const [warning] = evaluateReservationRules({
    startDate: start,
    endDate: end,
    storeSettings: rules,
  });
  if (!warning) {
    return { ok: true };
  }

  switch (warning.code) {
    case "business_hours":
      return { ok: false, issue: { code: "business_hours" } };
    case "advance_notice":
      return { ok: false, issue: { code: "advance_notice", duration: durationOf(warning.params) } };
    case "min_duration":
      return { ok: false, issue: { code: "min_duration", duration: durationOf(warning.params) } };
    case "max_duration":
      return { ok: false, issue: { code: "max_duration", duration: durationOf(warning.params) } };
  }
};

export type RentalQuickPresetKey = "thisWeekend" | "oneWeek" | "twoWeeks" | "oneMonth";

export interface RentalQuickPreset {
  key: RentalQuickPresetKey;
  /** Calendar days (local midnight); the picker applies the opening slots. */
  startDay: Date;
  endDay: Date;
}

const PRESET_LENGTHS: Record<Exclude<RentalQuickPresetKey, "thisWeekend">, number> = {
  oneWeek: 7,
  twoWeeks: 14,
  oneMonth: 30,
};

const nextOpenDay = (from: Date, rules: RentalPeriodRules): Date | null =>
  getNextAvailableDate(startOfDay(from), rules.businessHours, 60, rules.timezone);

const nextFriday = (from: Date): Date => {
  const day = from.getDay();
  const offset = day <= 5 ? 5 - day : 6;
  return addDays(startOfDay(from), offset);
};

/**
 * Presets a customer can tap instead of two calendar taps. Each one starts on
 * the first open day the advance notice allows and ends on the next open day
 * after the requested length, so a preset never lands on a closure.
 */
export const buildRentalQuickPresets = (
  rules: RentalPeriodRules,
  now: Date = new Date(),
): RentalQuickPreset[] => {
  const earliest = getMinStartDate(rules.advanceNoticeMinutes ?? 0);
  const firstDay = earliest > startOfDay(now) ? earliest : addDays(startOfDay(now), 1);
  const start = nextOpenDay(firstDay, rules);
  if (!start) return [];

  const keys: RentalQuickPresetKey[] =
    rules.pricingMode === "week"
      ? ["oneWeek", "twoWeeks", "oneMonth"]
      : ["thisWeekend", "oneWeek", "twoWeeks"];

  const presets: RentalQuickPreset[] = [];
  for (const key of keys) {
    const startDay = key === "thisWeekend" ? nextOpenDay(nextFriday(start), rules) : start;
    if (!startDay) continue;
    const length = key === "thisWeekend" ? 2 : PRESET_LENGTHS[key];
    const endDay = nextOpenDay(addDays(startDay, length), rules);
    if (!endDay) continue;
    presets.push({ key, startDay, endDay });
  }
  return presets;
};

/** Two ISO strings (URL params, cart storage) into a period, or null when either is missing or invalid. */
export const parseRentalPeriod = (
  start: string | null | undefined,
  end: string | null | undefined,
): RentalPeriodValue | null => {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return { start: startDate, end: endDate };
};

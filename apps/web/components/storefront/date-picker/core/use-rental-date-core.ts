'use client';

import { useCallback, useMemo } from 'react';
import { addDays } from 'date-fns';

import {
  buildStoreDate,
  generateTimeSlots,
  getAvailableTimeSlots,
  getNextAvailableDate,
  isDateAvailable,
} from '@/lib/utils/business-hours';
import { getMinStartDate, isTimeSlotAvailable, type PricingMode } from '@/lib/utils/duration';

import type { RentalDateCoreOptions, RentalDateCoreState, TimeRangeBuildOptions } from './types';

const DAY_MINUTES = 24 * 60;

export function applyTimeToDate(date: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

export function getTimeFromDate(date?: Date): string | undefined {
  if (!date) return undefined;
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function isCalendarDateBeforeSelectedDate(
  date: Date,
  selectedDate?: Date,
): boolean {
  if (!selectedDate) return false;

  const selectedDayStart = new Date(selectedDate);
  selectedDayStart.setHours(0, 0, 0, 0);
  return date < selectedDayStart;
}

export function ensureSelectedTime(
  current: string,
  slots: string[],
  fallback: 'first' | 'last' = 'first',
): string {
  if (slots.length === 0 || slots.includes(current)) {
    return current;
  }

  if (fallback === 'last') {
    return slots[slots.length - 1] ?? slots[0] ?? current;
  }

  return slots[0] ?? current;
}

export function createTimeSlots(start: string, end: string, intervalMinutes = 30): string[] {
  return generateTimeSlots(start, end, intervalMinutes);
}

export function buildDateTimeRange({
  startDate,
  endDate,
  startTime,
  endTime,
  timezone,
}: TimeRangeBuildOptions): { start: Date; end: Date } {
  return {
    start: buildStoreDate(startDate, startTime, timezone),
    end: buildStoreDate(endDate, endTime, timezone),
  };
}

export function isSameDayEndTimeSlotAllowed({
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
}): boolean {
  const startDateTime = buildStoreDate(startDate, startTime, timezone);
  const endDateTime = buildStoreDate(endDate, endTime, timezone);

  if (minRentalMinutes > 0) {
    return endDateTime.getTime() >= startDateTime.getTime() + minRentalMinutes * 60 * 1000;
  }

  return endDateTime.getTime() > startDateTime.getTime();
}

export function allowsSameDayRental(
  pricingMode: PricingMode,
  minRentalMinutes: number = 0,
): boolean {
  return pricingMode === 'hour' || minRentalMinutes < DAY_MINUTES;
}

export function getDefaultEndDateForStartDate({
  startDate,
  pricingMode,
  minRentalMinutes = 0,
  businessHours,
  timezone,
}: {
  startDate: Date;
  pricingMode: PricingMode;
  minRentalMinutes?: number;
  businessHours?: RentalDateCoreOptions['businessHours'];
  timezone?: string;
}): Date {
  if (allowsSameDayRental(pricingMode, minRentalMinutes)) {
    return startDate;
  }

  const nextDay = addDays(startDate, 1);
  return getNextAvailableDate(nextDay, businessHours, 365, timezone) ?? nextDay;
}

export function useRentalDateCore({
  startDate,
  endDate,
  startTime,
  minRentalMinutes = 0,
  businessHours,
  advanceNotice = 0,
  timezone,
  intervalMinutes = 30,
}: RentalDateCoreOptions): RentalDateCoreState {
  const defaultTimeSlots = useMemo(
    () => generateTimeSlots('07:00', '21:00', intervalMinutes),
    [intervalMinutes],
  );

  const minDate = useMemo(() => getMinStartDate(advanceNotice), [advanceNotice]);

  const isSameDay = useMemo(() => {
    if (!startDate || !endDate) return false;
    return startDate.toDateString() === endDate.toDateString();
  }, [startDate, endDate]);

  const startTimeSlots = useMemo(() => {
    if (!startDate) return defaultTimeSlots;

    const businessHoursSlots = getAvailableTimeSlots(
      startDate,
      businessHours,
      intervalMinutes,
      timezone,
    );

    return businessHoursSlots.filter((slot) =>
      isTimeSlotAvailable(startDate, slot, advanceNotice),
    );
  }, [startDate, businessHours, intervalMinutes, timezone, advanceNotice, defaultTimeSlots]);

  const endTimeSlots = useMemo(() => {
    if (!endDate) return defaultTimeSlots;

    const slots = getAvailableTimeSlots(endDate, businessHours, intervalMinutes, timezone);

    if (isSameDay && startDate && startTime) {
      return slots.filter((slot) =>
        isSameDayEndTimeSlotAllowed({
          startDate,
          startTime,
          endDate,
          endTime: slot,
          minRentalMinutes,
          timezone,
        }),
      );
    }

    return slots;
  }, [
    endDate,
    businessHours,
    intervalMinutes,
    timezone,
    isSameDay,
    startDate,
    startTime,
    minRentalMinutes,
    defaultTimeSlots,
  ]);

  const isDateDisabled = useCallback(
    (date: Date): boolean => {
      if (date < minDate) return true;
      if (!businessHours?.enabled) return false;
      const availability = isDateAvailable(date, businessHours, timezone);
      return !availability.available;
    },
    [minDate, businessHours, timezone],
  );

  return {
    defaultTimeSlots,
    minDate,
    isSameDay,
    startTimeSlots,
    endTimeSlots,
    isDateDisabled,
  };
}

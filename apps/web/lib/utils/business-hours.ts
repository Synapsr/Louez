import { format, isWithinInterval, parseISO, startOfDay, endOfDay, addDays, setHours, setMinutes } from 'date-fns'
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import type { BusinessHours, ClosurePeriod, DaySchedule } from '@louez/types'
import { normalizeDaySchedule } from '@louez/utils'

/**
 * Check if a date falls within any closure period.
 */
export function isInClosurePeriod(date: Date, closurePeriods: ClosurePeriod[] | undefined): ClosurePeriod | null {
  if (!closurePeriods || closurePeriods.length === 0) {
    return null
  }

  const dateStart = startOfDay(date)

  for (const period of closurePeriods) {
    if (!period.startDate || !period.endDate) continue

    try {
      const periodStart = startOfDay(parseISO(period.startDate))
      const periodEnd = endOfDay(parseISO(period.endDate))

      if (isWithinInterval(dateStart, { start: periodStart, end: periodEnd })) {
        return period
      }
    } catch {
      console.warn('Invalid closure period dates:', period)
    }
  }

  return null
}

/**
 * Get the normalized schedule for a specific day.
 * Handles both legacy (single openTime/closeTime) and current (ranges[]) formats.
 */
export function getDaySchedule(date: Date, businessHours: BusinessHours, timezone?: string): DaySchedule {
  const zonedDate = timezone ? toZonedTime(date, timezone) : date
  const dayOfWeek = zonedDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
  return normalizeDaySchedule(businessHours.schedule[dayOfWeek] as unknown as Record<string, unknown>)
}

/**
 * Check if a specific date/time is within business hours.
 * Supports multiple time ranges per day.
 */
export function isWithinBusinessHours(
  date: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string
): { valid: boolean; reason?: string; closurePeriod?: ClosurePeriod } {
  if (!businessHours?.enabled) {
    return { valid: true }
  }

  const closurePeriod = isInClosurePeriod(date, businessHours.closurePeriods)
  if (closurePeriod) {
    return { valid: false, reason: 'closure_period', closurePeriod }
  }

  const daySchedule = getDaySchedule(date, businessHours, timezone)

  if (!daySchedule.isOpen) {
    return { valid: false, reason: 'day_closed' }
  }

  const time = timezone
    ? formatInTimeZone(date, timezone, 'HH:mm')
    : format(date, 'HH:mm')

  const inRange = daySchedule.ranges.some(
    (range) => time >= range.openTime && time <= range.closeTime
  )

  if (!inRange) {
    return { valid: false, reason: 'outside_hours' }
  }

  return { valid: true }
}

/**
 * Check if an entire date is available (day is open and not in closure period).
 */
export function isDateAvailable(
  date: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string
): { available: boolean; reason?: string; closurePeriod?: ClosurePeriod } {
  if (!businessHours?.enabled) {
    return { available: true }
  }

  const closurePeriod = isInClosurePeriod(date, businessHours.closurePeriods)
  if (closurePeriod) {
    return { available: false, reason: 'closure_period', closurePeriod }
  }

  const daySchedule = getDaySchedule(date, businessHours, timezone)
  if (!daySchedule.isOpen) {
    return { available: false, reason: 'day_closed' }
  }

  return { available: true }
}

/**
 * Get available time slots for a specific date.
 * Merges slots from all time ranges for that day.
 */
export function getAvailableTimeSlots(
  date: Date,
  businessHours: BusinessHours | undefined,
  intervalMinutes: number = 30,
  timezone?: string
): string[] {
  const defaultSlots = generateTimeSlots('07:00', '21:00', intervalMinutes)

  if (!businessHours?.enabled) {
    return defaultSlots
  }

  const dateCheck = isDateAvailable(date, businessHours, timezone)
  if (!dateCheck.available) {
    return []
  }

  const daySchedule = getDaySchedule(date, businessHours, timezone)

  // Ranges are sorted by normalizeDaySchedule(), so concatenation preserves order.
  const allSlots: string[] = []
  for (const range of daySchedule.ranges) {
    allSlots.push(...generateTimeSlots(range.openTime, range.closeTime, intervalMinutes))
  }

  return allSlots
}

/**
 * Generate time slots between two times at a given interval.
 */
export function generateTimeSlots(
  startTime: string,
  endTime: string,
  intervalMinutes: number = 30
): string[] {
  const slots: string[] = []
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)

  let currentHour = startHour
  let currentMinute = startMinute

  while (
    currentHour < endHour ||
    (currentHour === endHour && currentMinute <= endMinute)
  ) {
    const time = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`
    slots.push(time)

    currentMinute += intervalMinutes
    if (currentMinute >= 60) {
      currentHour += Math.floor(currentMinute / 60)
      currentMinute = currentMinute % 60
    }
  }

  return slots
}

/**
 * Validate that a rental period (pickup + return) is within business hours.
 */
export function validateRentalPeriod(
  startDate: Date,
  endDate: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!businessHours?.enabled) {
    return { valid: true, errors: [] }
  }

  const startCheck = isWithinBusinessHours(startDate, businessHours, timezone)
  if (!startCheck.valid) {
    errors.push(`pickup_${startCheck.reason}`)
  }

  const endCheck = isWithinBusinessHours(endDate, businessHours, timezone)
  if (!endCheck.valid) {
    errors.push(`return_${endCheck.reason}`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Get the next available date starting from a given date.
 */
export function getNextAvailableDate(
  fromDate: Date,
  businessHours: BusinessHours | undefined,
  maxDaysToSearch: number = 365,
  timezone?: string
): Date | null {
  if (!businessHours?.enabled) {
    return fromDate
  }

  let currentDate = startOfDay(fromDate)

  for (let i = 0; i < maxDaysToSearch; i++) {
    const check = isDateAvailable(currentDate, businessHours, timezone)
    if (check.available) {
      return currentDate
    }
    currentDate = addDays(currentDate, 1)
  }

  return null
}

/**
 * Format a day schedule for display (e.g. "09:00 - 12:00, 14:00 - 18:00").
 */
export function formatDaySchedule(schedule: DaySchedule): string {
  if (!schedule.isOpen) {
    return 'closed'
  }
  return schedule.ranges.map((r) => `${r.openTime} - ${r.closeTime}`).join(', ')
}

/**
 * Get upcoming closure periods (sorted by start date).
 */
export function getUpcomingClosures(
  closurePeriods: ClosurePeriod[],
  fromDate: Date = new Date()
): ClosurePeriod[] {
  const now = startOfDay(fromDate)

  return closurePeriods
    .filter(period => endOfDay(parseISO(period.endDate)) >= now)
    .sort((a, b) => parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime())
}

/**
 * Build a UTC Date from a date and time string, interpreted in the store's timezone.
 * When the user selects "09:00" for a Paris store, this creates 09:00 Paris time (= 08:00 UTC).
 */
export function buildStoreDate(date: Date, time: string, timezone?: string): Date {
  const [hours, minutes] = time.split(':').map(Number)
  const localDate = setMinutes(setHours(date, hours), minutes)
  if (timezone) {
    return fromZonedTime(localDate, timezone)
  }
  return localDate
}

/**
 * Day keys in order starting from Monday (European convention).
 * 1 = Monday, 2 = Tuesday, ..., 6 = Saturday, 0 = Sunday
 */
export const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0] as const
export type DayKey = typeof DAY_KEYS[number]

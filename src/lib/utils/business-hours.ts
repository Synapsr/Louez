import { format, isWithinInterval, parseISO, startOfDay, endOfDay, addDays, setHours, setMinutes } from 'date-fns'
import { toZonedTime, formatInTimeZone } from 'date-fns-tz'
import type { BusinessHours, ClosurePeriod, DaySchedule } from '@/types/store'

/**
 * Check if a date falls within any closure period
 */
export function isInClosurePeriod(date: Date, closurePeriods: ClosurePeriod[] | undefined): ClosurePeriod | null {
  // Defensive: handle undefined or empty array
  if (!closurePeriods || closurePeriods.length === 0) {
    return null
  }

  const dateStart = startOfDay(date)

  for (const period of closurePeriods) {
    // Defensive: skip invalid periods
    if (!period.startDate || !period.endDate) continue

    try {
      const periodStart = startOfDay(parseISO(period.startDate))
      const periodEnd = endOfDay(parseISO(period.endDate))

      if (isWithinInterval(dateStart, { start: periodStart, end: periodEnd })) {
        return period
      }
    } catch {
      // Skip invalid date formats
      console.warn('Invalid closure period dates:', period)
    }
  }

  return null
}

/**
 * Get the schedule for a specific day
 * @param date - The date to check (in UTC or any timezone)
 * @param businessHours - The business hours configuration
 * @param timezone - The store's timezone (e.g., 'Europe/Paris'). If not provided, uses system timezone.
 */
export function getDaySchedule(date: Date, businessHours: BusinessHours, timezone?: string): DaySchedule {
  // Convert to the store's timezone to get the correct day of week
  const zonedDate = timezone ? toZonedTime(date, timezone) : date
  const dayOfWeek = zonedDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
  return businessHours.schedule[dayOfWeek]
}

/**
 * Check if a specific date/time is within business hours
 * @param date - The date/time to check (typically in UTC)
 * @param businessHours - The business hours configuration
 * @param timezone - The store's timezone (e.g., 'Europe/Paris'). If not provided, uses system timezone.
 */
export function isWithinBusinessHours(
  date: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string
): { valid: boolean; reason?: string; closurePeriod?: ClosurePeriod } {
  // If no business hours configured or disabled, always valid
  if (!businessHours?.enabled) {
    return { valid: true }
  }

  // Check closure periods first
  const closurePeriod = isInClosurePeriod(date, businessHours.closurePeriods)
  if (closurePeriod) {
    return {
      valid: false,
      reason: 'closure_period',
      closurePeriod
    }
  }

  // Get schedule for this day (using timezone for correct day of week)
  const daySchedule = getDaySchedule(date, businessHours, timezone)

  // Check if store is open on this day
  if (!daySchedule.isOpen) {
    return { valid: false, reason: 'day_closed' }
  }

  // Check time - format the time in the store's timezone
  const time = timezone
    ? formatInTimeZone(date, timezone, 'HH:mm')
    : format(date, 'HH:mm')
  if (time < daySchedule.openTime || time > daySchedule.closeTime) {
    return { valid: false, reason: 'outside_hours' }
  }

  return { valid: true }
}

/**
 * Check if an entire date is available (day is open and not in closure period)
 * @param date - The date to check (typically in UTC)
 * @param businessHours - The business hours configuration
 * @param timezone - The store's timezone (e.g., 'Europe/Paris'). If not provided, uses system timezone.
 */
export function isDateAvailable(
  date: Date,
  businessHours: BusinessHours | undefined,
  timezone?: string
): { available: boolean; reason?: string; closurePeriod?: ClosurePeriod } {
  if (!businessHours?.enabled) {
    return { available: true }
  }

  // Check closure periods
  const closurePeriod = isInClosurePeriod(date, businessHours.closurePeriods)
  if (closurePeriod) {
    return {
      available: false,
      reason: 'closure_period',
      closurePeriod
    }
  }

  // Check if day is open (using timezone for correct day of week)
  const daySchedule = getDaySchedule(date, businessHours, timezone)
  if (!daySchedule.isOpen) {
    return { available: false, reason: 'day_closed' }
  }

  return { available: true }
}

/**
 * Get available time slots for a specific date
 * @param date - The date to check (typically in UTC)
 * @param businessHours - The business hours configuration
 * @param intervalMinutes - The interval between time slots (default: 30)
 * @param timezone - The store's timezone (e.g., 'Europe/Paris'). If not provided, uses system timezone.
 */
export function getAvailableTimeSlots(
  date: Date,
  businessHours: BusinessHours | undefined,
  intervalMinutes: number = 30,
  timezone?: string
): string[] {
  // Default time slots if no business hours
  const defaultSlots = generateTimeSlots('07:00', '21:00', intervalMinutes)

  if (!businessHours?.enabled) {
    return defaultSlots
  }

  // Check if date is available at all
  const dateCheck = isDateAvailable(date, businessHours, timezone)
  if (!dateCheck.available) {
    return []
  }

  // Get schedule for this day
  const daySchedule = getDaySchedule(date, businessHours, timezone)

  return generateTimeSlots(daySchedule.openTime, daySchedule.closeTime, intervalMinutes)
}

/**
 * Generate time slots between two times
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
 * Validate that a rental period is within business hours
 * @param startDate - The start date/time (typically in UTC)
 * @param endDate - The end date/time (typically in UTC)
 * @param businessHours - The business hours configuration
 * @param timezone - The store's timezone (e.g., 'Europe/Paris'). If not provided, uses system timezone.
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

  // Check start date/time
  const startCheck = isWithinBusinessHours(startDate, businessHours, timezone)
  if (!startCheck.valid) {
    errors.push(`pickup_${startCheck.reason}`)
  }

  // Check end date/time
  const endCheck = isWithinBusinessHours(endDate, businessHours, timezone)
  if (!endCheck.valid) {
    errors.push(`return_${endCheck.reason}`)
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Get the next available date starting from a given date
 * @param fromDate - The starting date (typically in UTC)
 * @param businessHours - The business hours configuration
 * @param maxDaysToSearch - Maximum number of days to search (default: 365)
 * @param timezone - The store's timezone (e.g., 'Europe/Paris'). If not provided, uses system timezone.
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
 * Format business hours for display
 */
export function formatDaySchedule(schedule: DaySchedule): string {
  if (!schedule.isOpen) {
    return 'closed'
  }
  return `${schedule.openTime} - ${schedule.closeTime}`
}

/**
 * Get upcoming closure periods (sorted by start date)
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
 * Day keys in order starting from Monday (European convention)
 * 1 = Monday, 2 = Tuesday, ..., 6 = Saturday, 0 = Sunday
 */
export const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0] as const
export type DayKey = typeof DAY_KEYS[number]

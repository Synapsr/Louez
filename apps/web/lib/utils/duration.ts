/**
 * Centralized duration calculation utilities
 * Used consistently across the entire storefront
 */

export type PricingMode = 'day' | 'hour' | 'week'

/**
 * Calculate the duration between two dates based on pricing mode
 * Uses Math.ceil (round up) - industry standard: any partial period = full period billed
 */
export function calculateDuration(
  startDate: Date | string,
  endDate: Date | string,
  pricingMode: PricingMode
): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate
  const diffMs = end.getTime() - start.getTime()

  switch (pricingMode) {
    case 'hour':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
    case 'week':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
    case 'day':
    default:
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
  }
}

/**
 * Calculate the total price for a rental
 */
export function calculateRentalPrice(
  unitPrice: number,
  quantity: number,
  duration: number
): number {
  return unitPrice * quantity * duration
}

/**
 * Check if two date ranges overlap
 * Returns true if there is any overlap
 */
export function dateRangesOverlap(
  range1Start: Date | string,
  range1End: Date | string,
  range2Start: Date | string,
  range2End: Date | string
): boolean {
  const start1 = typeof range1Start === 'string' ? new Date(range1Start) : range1Start
  const end1 = typeof range1End === 'string' ? new Date(range1End) : range1End
  const start2 = typeof range2Start === 'string' ? new Date(range2Start) : range2Start
  const end2 = typeof range2End === 'string' ? new Date(range2End) : range2End

  // Ranges overlap if one starts before the other ends
  return start1 < end2 && start2 < end1
}

/**
 * Get default dates for rental (today + 1 day to today + 2 days)
 */
export function getDefaultRentalDates(): { startDate: Date; endDate: Date } {
  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() + 1) // Tomorrow

  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + 1) // Day after tomorrow

  return { startDate, endDate }
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | string, locale: string = 'fr-FR'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Format a date range for display
 */
export function formatDateRange(
  startDate: Date | string,
  endDate: Date | string,
  locale: string = 'fr-FR'
): string {
  return `${formatDate(startDate, locale)} - ${formatDate(endDate, locale)}`
}

/**
 * Check if a date is in the past
 */
export function isDateInPast(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

/**
 * Get the minimum start date (day only, for calendar date selection)
 * This returns the first day that MAY have available time slots.
 * Use getMinStartDateTime for the exact minimum time.
 */
export function getMinStartDate(advanceNoticeMinutes: number = 0): Date {
  const minDateTime = getMinStartDateTime(advanceNoticeMinutes)
  const minDate = new Date(minDateTime)
  minDate.setHours(0, 0, 0, 0)
  return minDate
}

/**
 * Get the exact minimum start date/time based on advance notice
 * This returns the precise moment when a reservation can start.
 */
export function getMinStartDateTime(advanceNoticeMinutes: number = 0): Date {
  const now = new Date()
  return new Date(now.getTime() + advanceNoticeMinutes * 60 * 1000)
}

/**
 * Check if a specific time slot is available based on advance notice
 * Returns true if the time slot is AFTER the minimum required time
 */
export function isTimeSlotAvailable(
  date: Date,
  timeSlot: string,
  advanceNoticeMinutes: number = 0
): boolean {
  const [hours, minutes] = timeSlot.split(':').map(Number)
  const slotDateTime = new Date(date)
  slotDateTime.setHours(hours, minutes, 0, 0)

  const minDateTime = getMinStartDateTime(advanceNoticeMinutes)
  return slotDateTime >= minDateTime
}

/**
 * Calculate detailed duration breakdown (days and hours)
 */
export function getDetailedDuration(
  startDate: Date | string,
  endDate: Date | string
): { days: number; hours: number; totalHours: number } {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate

  const diffMs = end.getTime() - start.getTime()
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  return { days, hours, totalHours }
}

/**
 * Format detailed duration as localized string
 * Examples: "3 jours", "2 jours et 5h", "8h"
 */
export function formatDetailedDuration(
  startDate: Date | string,
  endDate: Date | string,
  translations: {
    day: string
    days: string
    and: string
  }
): string {
  const { days, hours } = getDetailedDuration(startDate, endDate)

  if (days === 0) {
    return `${hours}h`
  }

  const dayLabel = days === 1 ? translations.day : translations.days

  if (hours === 0) {
    return `${days} ${dayLabel}`
  }

  return `${days} ${dayLabel} ${translations.and} ${hours}h`
}

/**
 * Format date with time for display
 */
export function formatDateTime(
  date: Date | string,
  options?: { includeYear?: boolean; timezone?: string }
): { date: string; time: string } {
  const d = typeof date === 'string' ? new Date(date) : date

  const dateStr = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(options?.includeYear && { year: 'numeric' }),
    ...(options?.timezone && { timeZone: options.timezone }),
  })

  const timeStr = d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(options?.timezone && { timeZone: options.timezone }),
  })

  return { date: dateStr, time: timeStr }
}

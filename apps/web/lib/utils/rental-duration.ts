/**
 * Rental duration utilities in minutes.
 */

import type { StoreSettings } from '@louez/types'

export function getMinRentalMinutes(settings: StoreSettings | null | undefined): number {
  if (!settings) return 60
  if (
    settings.minRentalMinutes !== undefined &&
    settings.minRentalMinutes !== null
  ) {
    return settings.minRentalMinutes
  }
  return 60
}

export function getMaxRentalMinutes(
  settings: StoreSettings | null | undefined
): number | null {
  if (!settings) return null
  if (settings.maxRentalMinutes !== undefined) {
    return settings.maxRentalMinutes
  }
  return null
}

/**
 * Calculate the rental duration in hours between two dates.
 */
export function getRentalDurationHours(
  startDate: Date | string,
  endDate: Date | string
): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60)
}

/**
 * Format a duration in minutes as a compact string for UI messaging.
 * Examples: 30 -> "30 min", 120 -> "2h", 1440 -> "1d"
 */
export function formatDurationFromMinutes(minutes: number): string {
  const safeMinutes = Math.max(0, Math.ceil(minutes))

  if (safeMinutes >= 1440 && safeMinutes % 1440 === 0) {
    return `${safeMinutes / 1440}d`
  }

  if (safeMinutes >= 60 && safeMinutes % 60 === 0) {
    return `${safeMinutes / 60}h`
  }

  return `${safeMinutes} min`
}

interface DurationValidationResult {
  valid: boolean
  actualMinutes: number
  requiredMinutes: number
}

/**
 * Validate that a rental period meets the minimum duration requirement.
 * Returns valid: true immediately when minHours <= 0 (no restriction).
 */
export function validateMinRentalDurationMinutes(
  startDate: Date | string,
  endDate: Date | string,
  minMinutes: number
): DurationValidationResult {
  if (minMinutes <= 0) {
    return { valid: true, actualMinutes: 0, requiredMinutes: 0 }
  }

  const actualMinutes = getRentalDurationHours(startDate, endDate) * 60
  return {
    valid: actualMinutes >= minMinutes,
    actualMinutes: Math.round(actualMinutes),
    requiredMinutes: minMinutes,
  }
}

/**
 * Validate that a rental period does not exceed the maximum duration.
 * Returns valid: true immediately when maxHours is null (no limit).
 */
export function validateMaxRentalDurationMinutes(
  startDate: Date | string,
  endDate: Date | string,
  maxMinutes: number | null
): DurationValidationResult {
  if (maxMinutes === null) {
    return { valid: true, actualMinutes: 0, requiredMinutes: 0 }
  }

  const actualMinutes = getRentalDurationHours(startDate, endDate) * 60
  return {
    valid: actualMinutes <= maxMinutes,
    actualMinutes: Math.round(actualMinutes),
    requiredMinutes: maxMinutes,
  }
}

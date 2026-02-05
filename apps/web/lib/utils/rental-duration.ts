/**
 * Rental duration utilities
 *
 * Handles minimum/maximum rental duration validation and backward
 * compatibility with the legacy minDuration/maxDuration fields
 * (which were relative to the store's pricingMode).
 *
 * New fields (minRentalHours / maxRentalHours) are always in hours.
 */

import type { StoreSettings, PricingMode } from '@louez/types'

const HOURS_PER_UNIT: Record<PricingMode, number> = {
  hour: 1,
  day: 24,
  week: 168,
}

/**
 * Get the effective minimum rental duration in hours.
 * Falls back to converting legacy minDuration based on pricingMode.
 */
export function getMinRentalHours(settings: StoreSettings | null | undefined): number {
  if (!settings) return 1

  if (settings.minRentalHours !== undefined && settings.minRentalHours !== null) {
    return settings.minRentalHours
  }

  // Legacy fallback: convert minDuration * pricingMode unit to hours
  const legacyDuration = settings.minDuration ?? 1
  const multiplier = HOURS_PER_UNIT[settings.pricingMode] ?? 24
  return legacyDuration * multiplier
}

/**
 * Get the effective maximum rental duration in hours.
 * Falls back to converting legacy maxDuration based on pricingMode.
 * Returns null if there is no maximum.
 */
export function getMaxRentalHours(settings: StoreSettings | null | undefined): number | null {
  if (!settings) return null

  if (settings.maxRentalHours !== undefined) {
    return settings.maxRentalHours
  }

  // Legacy fallback
  if (settings.maxDuration === null || settings.maxDuration === undefined) {
    return null
  }

  const multiplier = HOURS_PER_UNIT[settings.pricingMode] ?? 24
  return settings.maxDuration * multiplier
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

interface DurationValidationResult {
  valid: boolean
  actualHours: number
  requiredHours: number
}

/**
 * Validate that a rental period meets the minimum duration requirement.
 * Returns valid: true immediately when minHours <= 0 (no restriction).
 */
export function validateMinRentalDuration(
  startDate: Date | string,
  endDate: Date | string,
  minHours: number
): DurationValidationResult {
  if (minHours <= 0) {
    return { valid: true, actualHours: 0, requiredHours: 0 }
  }

  const actualHours = getRentalDurationHours(startDate, endDate)
  return {
    valid: actualHours >= minHours,
    actualHours: Math.round(actualHours * 10) / 10,
    requiredHours: minHours,
  }
}

/**
 * Validate that a rental period does not exceed the maximum duration.
 * Returns valid: true immediately when maxHours is null (no limit).
 */
export function validateMaxRentalDuration(
  startDate: Date | string,
  endDate: Date | string,
  maxHours: number | null
): DurationValidationResult {
  if (maxHours === null) {
    return { valid: true, actualHours: 0, requiredHours: 0 }
  }

  const actualHours = getRentalDurationHours(startDate, endDate)
  return {
    valid: actualHours <= maxHours,
    actualHours: Math.round(actualHours * 10) / 10,
    requiredHours: maxHours,
  }
}

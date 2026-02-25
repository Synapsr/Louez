import type { DaySchedule } from '@louez/types'

/**
 * Normalizes a DaySchedule from either legacy or current format,
 * and ensures ranges are sorted chronologically by openTime.
 *
 * Legacy format (single range):
 *   { isOpen: true, openTime: "09:00", closeTime: "18:00" }
 *
 * Current format (multiple ranges):
 *   { isOpen: true, ranges: [{ openTime: "09:00", closeTime: "12:00" }, { openTime: "14:00", closeTime: "18:00" }] }
 *
 * This ensures backward compatibility with stores that still have
 * the old format stored in their JSON settings column.
 */
export function normalizeDaySchedule(schedule: Record<string, unknown>): DaySchedule {
  if ('ranges' in schedule && Array.isArray(schedule.ranges)) {
    const typed = schedule as unknown as DaySchedule
    return {
      ...typed,
      ranges: [...typed.ranges].sort((a, b) => a.openTime.localeCompare(b.openTime)),
    }
  }

  // Legacy format: single openTime/closeTime at the top level
  return {
    isOpen: Boolean(schedule.isOpen),
    ranges: [
      {
        openTime: (schedule.openTime as string) ?? '09:00',
        closeTime: (schedule.closeTime as string) ?? '18:00',
      },
    ],
  }
}

import { z } from 'zod'

// Time format validation (HH:mm, 24-hour)
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, {
  message: 'Invalid time format (expected HH:mm)',
})

export const timeRangeSchema = z
  .object({
    openTime: timeSchema,
    closeTime: timeSchema,
  })
  .refine((data) => data.openTime < data.closeTime, {
    message: 'Close time must be after open time',
  })

/**
 * Validates that time ranges within a day do not overlap.
 * Ranges must be sorted chronologically and non-overlapping.
 * Example valid: [09:00-12:00, 14:00-18:00]
 * Example invalid: [09:00-14:00, 12:00-18:00] (overlap)
 */
function rangesDoNotOverlap(ranges: { openTime: string; closeTime: string }[]): boolean {
  if (ranges.length < 2) return true
  const sorted = [...ranges].sort((a, b) => a.openTime.localeCompare(b.openTime))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].openTime < sorted[i - 1].closeTime) return false
  }
  return true
}

export const dayScheduleSchema = z
  .object({
    isOpen: z.boolean(),
    ranges: z.array(timeRangeSchema),
  })
  .refine((data) => !data.isOpen || data.ranges.length > 0, {
    message: 'At least one time range is required when the day is open',
  })
  .refine((data) => !data.isOpen || rangesDoNotOverlap(data.ranges), {
    message: 'Time ranges must not overlap',
  })

export const closurePeriodSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    startDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    endDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => new Date(data.startDate) <= new Date(data.endDate), {
    message: 'End date must be after or equal to start date',
  })

export const businessHoursSchema = z.object({
  enabled: z.boolean(),
  schedule: z.object({
    0: dayScheduleSchema, // Sunday
    1: dayScheduleSchema, // Monday
    2: dayScheduleSchema, // Tuesday
    3: dayScheduleSchema, // Wednesday
    4: dayScheduleSchema, // Thursday
    5: dayScheduleSchema, // Friday
    6: dayScheduleSchema, // Saturday
  }),
  closurePeriods: z.array(closurePeriodSchema),
})

export type TimeRangeInput = z.infer<typeof timeRangeSchema>
export type DayScheduleInput = z.infer<typeof dayScheduleSchema>
export type ClosurePeriodInput = z.infer<typeof closurePeriodSchema>
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>

// Default business hours configuration
export const defaultBusinessHours: BusinessHoursInput = {
  enabled: true,
  schedule: {
    0: { isOpen: false, ranges: [{ openTime: '09:00', closeTime: '18:00' }] }, // Sunday - closed
    1: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '18:00' }] },  // Monday
    2: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '18:00' }] },  // Tuesday
    3: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '18:00' }] },  // Wednesday
    4: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '18:00' }] },  // Thursday
    5: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '18:00' }] },  // Friday
    6: { isOpen: true, ranges: [{ openTime: '09:00', closeTime: '12:00' }] },  // Saturday - morning only
  },
  closurePeriods: [],
}

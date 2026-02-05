import { z } from 'zod'

// Time format validation (HH:mm)
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, {
  message: 'Invalid time format (expected HH:mm)',
})

export const dayScheduleSchema = z.object({
  isOpen: z.boolean(),
  openTime: timeSchema,
  closeTime: timeSchema,
}).refine(
  (data) => {
    if (!data.isOpen) return true
    return data.openTime < data.closeTime
  },
  { message: 'Close time must be after open time' }
)

export const closurePeriodSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  startDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  reason: z.string().max(500).optional(),
}).refine(
  (data) => new Date(data.startDate) <= new Date(data.endDate),
  { message: 'End date must be after or equal to start date' }
)

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

export type DayScheduleInput = z.infer<typeof dayScheduleSchema>
export type ClosurePeriodInput = z.infer<typeof closurePeriodSchema>
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>

// Default business hours configuration (always enabled)
export const defaultBusinessHours: BusinessHoursInput = {
  enabled: true,
  schedule: {
    0: { isOpen: false, openTime: '09:00', closeTime: '18:00' },  // Sunday - closed
    1: { isOpen: true, openTime: '09:00', closeTime: '18:00' },   // Monday
    2: { isOpen: true, openTime: '09:00', closeTime: '18:00' },   // Tuesday
    3: { isOpen: true, openTime: '09:00', closeTime: '18:00' },   // Wednesday
    4: { isOpen: true, openTime: '09:00', closeTime: '18:00' },   // Thursday
    5: { isOpen: true, openTime: '09:00', closeTime: '18:00' },   // Friday
    6: { isOpen: true, openTime: '09:00', closeTime: '12:00' },   // Saturday - morning only
  },
  closurePeriods: [],
}

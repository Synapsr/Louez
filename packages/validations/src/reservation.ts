import { z } from 'zod'

export const reservationStatusSchema = z.enum([
  'pending',
  'confirmed',
  'ongoing',
  'completed',
  'cancelled',
  'rejected',
])

// Schema factories that accept translation function
export const createReservationItemSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    productId: z.string().min(1, t('required')),
    quantity: z.number().min(1, t('minValue', { min: 1 })),
  })

export const createManualReservationSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    // Customer
    customerType: z.enum(['existing', 'new']),
    customerId: z.string().optional(),
    email: z.string().email(t('email')).optional(),
    firstName: z.string().min(1, t('required')).optional(),
    lastName: z.string().min(1, t('required')).optional(),
    phone: z.string().optional(),

    // Dates
    startDate: z.date({ message: t('required') }),
    endDate: z.date({ message: t('required') }),

    // Items
    items: z.array(createReservationItemSchema(t)).min(1, t('required')),

    // Notes
    internalNotes: z.string().optional(),
  })

// Default schemas for server-side validation
export const reservationItemSchema = z.object({
  productId: z.string().min(1, 'validation.required'),
  quantity: z.number().min(1, 'validation.minValue'),
})

export const manualReservationSchema = z.object({
  // Customer
  customerType: z.enum(['existing', 'new']),
  customerId: z.string().optional(),
  email: z.string().email('validation.email').optional(),
  firstName: z.string().min(1, 'validation.required').optional(),
  lastName: z.string().min(1, 'validation.required').optional(),
  phone: z.string().optional(),

  // Dates
  startDate: z.date({ message: 'validation.required' }),
  endDate: z.date({ message: 'validation.required' }),

  // Items
  items: z.array(reservationItemSchema).min(1, 'validation.required'),

  // Notes
  internalNotes: z.string().optional(),
})

export const updateReservationNotesSchema = z.object({
  internalNotes: z.string().optional(),
})

export type ReservationStatus = z.infer<typeof reservationStatusSchema>
export type ReservationItem = z.infer<typeof reservationItemSchema>
export type ManualReservationInput = z.infer<typeof manualReservationSchema>

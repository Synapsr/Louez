import { z } from 'zod'

// Schema factory that accepts translation function
export const createCustomerSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    email: z.string().email(t('email')),
    firstName: z.string().min(1, t('required')).max(255),
    lastName: z.string().min(1, t('required')).max(255),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().length(2, t('minLength', { min: 2 })).optional(),
    notes: z.string().optional(),
  })

// Default schema for server-side validation (uses keys that client will translate)
export const customerSchema = z.object({
  email: z.string().email('validation.email'),
  firstName: z.string().min(1, 'validation.required').max(255),
  lastName: z.string().min(1, 'validation.required').max(255),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2, 'validation.minLength').optional(),
  notes: z.string().optional(),
})

export type CustomerInput = z.infer<typeof customerSchema>

import { z } from 'zod'

// Customer type enum
export const customerTypeValues = ['individual', 'business'] as const
export type CustomerType = (typeof customerTypeValues)[number]

// E.164 phone format regex (optional - empty string allowed)
const phoneRegex = /^\+[1-9]\d{6,14}$/

// Base schema without refinement for form validation
const baseCustomerFields = {
  customerType: z.enum(customerTypeValues),
  email: z.string().email('validation.email'),
  firstName: z.string().min(1, 'validation.required').max(255),
  lastName: z.string().min(1, 'validation.required').max(255),
  companyName: z.string().max(255).optional(),
  phone: z.string().refine(
    (val) => !val || phoneRegex.test(val),
    { message: 'validation.invalidPhone' }
  ).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2, 'validation.minLength').optional(),
  notes: z.string().optional(),
}

// Schema factory that accepts translation function
export const createCustomerSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    customerType: z.enum(customerTypeValues),
    email: z.string().email(t('email')),
    firstName: z.string().min(1, t('required')).max(255),
    lastName: z.string().min(1, t('required')).max(255),
    companyName: z.string().max(255).optional(),
    phone: z.string().refine(
      (val) => !val || phoneRegex.test(val),
      { message: t('invalidPhone') }
    ).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().length(2, t('minLength', { min: 2 })).optional(),
    notes: z.string().optional(),
  }).superRefine((data, ctx) => {
    // If business customer, company name is required
    if (data.customerType === 'business' && (!data.companyName || data.companyName.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('companyNameRequired'),
        path: ['companyName'],
      })
    }
  })

// Default schema for server-side validation (uses keys that client will translate)
export const customerSchema = z.object(baseCustomerFields).superRefine((data, ctx) => {
  // If business customer, company name is required
  if (data.customerType === 'business' && (!data.companyName || data.companyName.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'validation.companyNameRequired',
      path: ['companyName'],
    })
  }
})

export type CustomerInput = z.infer<typeof customerSchema>

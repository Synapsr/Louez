import { z } from 'zod'

// Schema factories that accept translation function
export const createStoreInfoSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(100, t('maxLength', { max: 100 })),
    slug: z
      .string()
      .min(3, t('minLength', { min: 3 }))
      .max(50, t('maxLength', { max: 50 }))
      .regex(/^[a-z0-9-]+$/, t('slug')),
    pricingMode: z.enum(['day', 'hour']),
    address: z.string().optional().or(z.literal('')),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    email: z.string().email(t('email')).optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
  })

export const createBrandingSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    logoUrl: z.string().url().optional().or(z.literal('')),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, t('url')),
    theme: z.enum(['light', 'dark']),
  })

export const createFirstProductSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(255, t('maxLength', { max: 255 })),
    description: z.string().optional(),
    price: z.string().regex(/^\d+([.,]\d{1,2})?$/, t('positive')),
    deposit: z
      .string()
      .regex(/^\d+([.,]\d{1,2})?$/, t('positive'))
      .optional()
      .or(z.literal('')),
    quantity: z.string().regex(/^\d+$/, t('integer')),
    images: z.array(z.string()).optional(),
  })

// Default schemas for server-side validation
export const storeInfoSchema = z.object({
  name: z
    .string()
    .min(2, 'validation.minLength')
    .max(100, 'validation.maxLength'),
  slug: z
    .string()
    .min(3, 'validation.minLength')
    .max(50, 'validation.maxLength')
    .regex(/^[a-z0-9-]+$/, 'validation.slug'),
  pricingMode: z.enum(['day', 'hour']),
  address: z.string().optional().or(z.literal('')),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  email: z.string().email('validation.email').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
})

export const brandingSchema = z.object({
  logoUrl: z.string().url().optional().or(z.literal('')),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'validation.url'),
  theme: z.enum(['light', 'dark']),
})

export const firstProductSchema = z.object({
  name: z
    .string()
    .min(2, 'validation.minLength')
    .max(255, 'validation.maxLength'),
  description: z.string().optional(),
  price: z.string().regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive'),
  deposit: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
    .optional()
    .or(z.literal('')),
  quantity: z.string().regex(/^\d+$/, 'validation.integer'),
  images: z.array(z.string()).optional(),
})

export const stripeSetupSchema = z.object({
  reservationMode: z.enum(['payment', 'request']),
})

export type StoreInfoInput = z.infer<typeof storeInfoSchema>
export type BrandingInput = z.infer<typeof brandingSchema>
export type FirstProductInput = z.infer<typeof firstProductSchema>
export type StripeSetupInput = z.infer<typeof stripeSetupSchema>

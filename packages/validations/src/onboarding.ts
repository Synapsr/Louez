import { z } from 'zod'
import { isValidImageUrl, isValidImageUrlClient } from './image'

// ===== RESERVED SLUGS =====
// These slugs are reserved to prevent namespace conflicts and potential phishing

export const RESERVED_SLUGS = [
  // System routes
  'api',
  'app',
  'admin',
  'dashboard',
  'login',
  'logout',
  'register',
  'signup',
  'signin',
  'auth',
  'oauth',
  'callback',
  'verify',
  'reset',
  'password',
  'settings',
  'account',
  'profile',
  'user',
  'users',
  'onboarding',
  'invitation',
  'invite',
  'webhook',
  'webhooks',

  // Brand protection
  'louez',
  'louez-io',
  'louezio',
  'www',
  'mail',
  'email',
  'ftp',
  'cdn',
  'static',
  'assets',
  'images',
  'img',
  'files',
  'uploads',
  'media',

  // Reserved for future use
  'blog',
  'docs',
  'documentation',
  'help',
  'support',
  'status',
  'health',
  'terms',
  'privacy',
  'legal',
  'about',
  'contact',
  'pricing',
  'plans',
  'billing',
  'checkout',
  'cart',
  'store',
  'stores',
  'shop',
  'marketplace',

  // Common abuse patterns
  'test',
  'demo',
  'example',
  'sample',
  'null',
  'undefined',
  'true',
  'false',
  'admin1',
  'administrator',
  'root',
  'system',
  'localhost',

  // Internationalization
  'fr',
  'en',
  'de',
  'es',
  'it',
  'nl',
  'pl',
  'pt',
] as const

/**
 * Check if a slug is reserved
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.toLowerCase() as typeof RESERVED_SLUGS[number])
}

// ===== SCHEMA FACTORIES =====
// These schemas accept a translation function for client-side validation with i18n

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
      .regex(/^[a-z0-9-]+$/, t('slug'))
      .refine((val) => !isReservedSlug(val), t('slugReserved')),
    pricingMode: z.enum(['day', 'hour']),
    country: z.string().length(2),
    currency: z.string().min(3).max(3),
    address: z.string().or(z.literal('')),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    email: z.string().email(t('email')).or(z.literal('')),
    phone: z.string().or(z.literal('')),
  })

export const createBrandingSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    // Client-safe validation: strict S3 check happens server-side in the action
    logoUrl: z
      .string()
      .refine((val) => !val || val === '' || isValidImageUrlClient(val), {
        message: t('invalidImageUrl'),
      })
      .optional()
      .or(z.literal('')),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, t('color')),
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
    // Client-safe validation: strict S3 check happens server-side in the action
    images: z
      .array(
        z.string().refine((val) => !val || isValidImageUrlClient(val), {
          message: t('invalidImageUrl'),
        })
      )
      .max(10)
      .optional(),
  })

// ===== SERVER-SIDE SCHEMAS =====
// Default schemas for server-side validation without i18n

export const storeInfoSchema = z.object({
  name: z
    .string()
    .min(2, 'validation.minLength')
    .max(100, 'validation.maxLength'),
  slug: z
    .string()
    .min(3, 'validation.minLength')
    .max(50, 'validation.maxLength')
    .regex(/^[a-z0-9-]+$/, 'validation.slug')
    .refine((val) => !isReservedSlug(val), 'validation.slugReserved'),
  pricingMode: z.enum(['day', 'hour']),
  country: z.string().length(2),
  currency: z.string().min(3).max(3),
  address: z.string().optional().or(z.literal('')),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  email: z.string().email('validation.email').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
})

export const brandingSchema = z.object({
  // SECURITY: Validate image URL to prevent malicious uploads
  logoUrl: z
    .string()
    .refine((val) => !val || val === '' || isValidImageUrl(val), {
      message: 'validation.invalidImageUrl',
    })
    .optional()
    .or(z.literal('')),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'validation.color'),
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
  // SECURITY: Validate image URLs to prevent malicious uploads
  images: z
    .array(
      z.string().refine((val) => !val || isValidImageUrl(val), {
        message: 'validation.invalidImageUrl',
      })
    )
    .max(10)
    .optional(),
})

export const stripeSetupSchema = z.object({
  reservationMode: z.enum(['payment', 'request']),
})

export type StoreInfoInput = z.infer<typeof storeInfoSchema>
export type BrandingInput = z.infer<typeof brandingSchema>
export type FirstProductInput = z.infer<typeof firstProductSchema>
export type StripeSetupInput = z.infer<typeof stripeSetupSchema>

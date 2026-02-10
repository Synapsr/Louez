import { z } from 'zod'

// Image URL validation - allows http/https URLs and legacy base64 data URIs
// Note: base64 is allowed for backwards compatibility with old products,
// but new uploads should go through S3
const imageUrlSchema = z
  .string()
  .refine(
    (url) => url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'),
    'Invalid image URL. Must be a valid HTTP(S) URL or image data URI.'
  )

// Pricing tier schema
export const pricingTierSchema = z.object({
  id: z.string().optional(),
  minDuration: z.number().int().min(1, 'La durée minimum doit être au moins 1'),
  discountPercent: z
    .number()
    .min(0, 'La réduction ne peut pas être négative')
    .max(99, 'La réduction ne peut pas dépasser 99%'),
})

// Tax settings schema for product
export const productTaxSettingsSchema = z.object({
  inheritFromStore: z.boolean(),
  customRate: z.number().min(0).max(100).optional(),
})

// Product unit schema for individual unit tracking
// Note: identifier min length is NOT enforced here — it's conditionally validated
// via .superRefine() on the parent schema only when trackUnits is true.
export const productUnitSchema = z.object({
  id: z.string().optional(), // Absent for new units
  identifier: z.string().max(255, 'validation.maxLength'),
  notes: z.string().max(1000).optional().or(z.literal('')),
  status: z.enum(['available', 'maintenance', 'retired']).optional(),
})

export type PricingTierInput = z.infer<typeof pricingTierSchema>
export type ProductUnitInput = z.infer<typeof productUnitSchema>

// Schema factory that accepts translation function
// YouTube URL validation regex
const youtubeUrlRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/

export const createProductSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(255, t('maxLength', { max: 255 })),
    description: z.string(),
    categoryId: z.string().nullable(),
    price: z.string().regex(/^\d+([.,]\d{1,2})?$/, t('positive')),
    deposit: z.string().regex(/^\d+([.,]\d{1,2})?$/, t('positive')).or(z.literal('')),
    quantity: z.string().regex(/^\d+$/, t('integer')),
    status: z.enum(['draft', 'active', 'archived']),
    images: z.array(
      z
        .string()
        .refine(
          (url) =>
            url.startsWith('http://') ||
            url.startsWith('https://') ||
            url.startsWith('data:image/'),
          t('invalidImageUrl'),
        ),
    ),
    pricingMode: z.enum(['hour', 'day', 'week']),
    pricingTiers: z.array(
      z.object({
        id: z.string().optional(),
        minDuration: z.number().int().min(1, t('minValue', { min: 1 })),
        discountPercent: z
          .number()
          .min(0, t('minValue', { min: 0 }))
          .max(99, t('maxValue', { max: 99 })),
      }),
    ),
    enforceStrictTiers: z.boolean(),
    taxSettings: productTaxSettingsSchema,
    videoUrl: z.string().regex(youtubeUrlRegex, t('invalidYoutubeUrl')).or(z.literal('')),
    accessoryIds: z.array(z.string()),
    // Unit tracking
    trackUnits: z.boolean(),
    units: z.array(
      z.object({
        id: z.string().optional(), // Absent for new units
        identifier: z.string().max(255, t('maxLength', { max: 255 })),
        notes: z
          .string()
          .max(1000, t('maxLength', { max: 1000 }))
          .optional()
          .or(z.literal('')),
        status: z.enum(['available', 'maintenance', 'retired']).optional(),
      }),
    ),
  }).superRefine((data, ctx) => {
    if (data.trackUnits && data.units) {
      for (let i = 0; i < data.units.length; i++) {
        if (!data.units[i].identifier || !data.units[i].identifier.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('required'),
            path: ['units', i, 'identifier'],
          })
        }
      }
    }
  })

export const createCategorySchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(255, t('maxLength', { max: 255 })),
    description: z.string().optional(),
  })

// Default schemas for server-side validation
export const productSchema = z.object({
  name: z
    .string()
    .min(2, 'validation.minLength')
    .max(255, 'validation.maxLength'),
  description: z.string().optional(),
  categoryId: z.string().optional().nullable(),
  price: z.string().regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive'),
  deposit: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
    .optional()
    .or(z.literal('')),
  quantity: z.string().regex(/^\d+$/, 'validation.integer'),
  status: z.enum(['draft', 'active', 'archived']),
  images: z.array(imageUrlSchema).optional(),
  pricingMode: z.enum(['hour', 'day', 'week']),
  pricingTiers: z.array(pricingTierSchema).optional(),
  enforceStrictTiers: z.boolean().optional(),
  taxSettings: productTaxSettingsSchema.optional(),
  videoUrl: z
    .string()
    .regex(youtubeUrlRegex, 'validation.invalidYoutubeUrl')
    .optional()
    .or(z.literal('')),
  accessoryIds: z.array(z.string()).optional(),
  // Unit tracking
  trackUnits: z.boolean().optional(),
  units: z.array(productUnitSchema).optional(),
}).superRefine((data, ctx) => {
  if (data.trackUnits && data.units) {
    for (let i = 0; i < data.units.length; i++) {
      if (!data.units[i].identifier || !data.units[i].identifier.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'validation.required',
          path: ['units', i, 'identifier'],
        })
      }
    }
  }
})

export const categorySchema = z.object({
  name: z
    .string()
    .min(2, 'validation.minLength')
    .max(255, 'validation.maxLength'),
  description: z.string().optional(),
})

export type ProductInput = z.infer<typeof productSchema>
export type CategoryInput = z.infer<typeof categorySchema>

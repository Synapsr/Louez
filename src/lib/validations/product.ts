import { z } from 'zod'

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

export type PricingTierInput = z.infer<typeof pricingTierSchema>

// Schema factory that accepts translation function
// YouTube URL validation regex
const youtubeUrlRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/

export const createProductSchema = (t: (key: string, params?: Record<string, string | number | Date>) => string) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(255, t('maxLength', { max: 255 })),
    description: z.string().optional(),
    categoryId: z.string().optional().nullable(),
    price: z.string().regex(/^\d+([.,]\d{1,2})?$/, t('positive')),
    deposit: z
      .string()
      .regex(/^\d+([.,]\d{1,2})?$/, t('positive'))
      .optional()
      .or(z.literal('')),
    quantity: z.string().regex(/^\d+$/, t('integer')),
    status: z.enum(['draft', 'active', 'archived']),
    images: z.array(z.string()).optional(),
    pricingMode: z.enum(['hour', 'day', 'week']).nullable().optional(),
    pricingTiers: z.array(pricingTierSchema).optional(),
    taxSettings: productTaxSettingsSchema.optional(),
    videoUrl: z
      .string()
      .regex(youtubeUrlRegex, t('invalidYoutubeUrl'))
      .optional()
      .or(z.literal('')),
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
  images: z.array(z.string()).optional(),
  pricingMode: z.enum(['hour', 'day', 'week']).nullable().optional(),
  pricingTiers: z.array(pricingTierSchema).optional(),
  taxSettings: productTaxSettingsSchema.optional(),
  videoUrl: z
    .string()
    .regex(youtubeUrlRegex, 'validation.invalidYoutubeUrl')
    .optional()
    .or(z.literal('')),
  accessoryIds: z.array(z.string()).optional(),
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

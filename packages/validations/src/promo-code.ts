import { z } from 'zod'

const PROMO_CODE_REGEX = /^[A-Z0-9_-]+$/i

export const promoCodeTypeSchema = z.enum(['percentage', 'fixed'])

export const createPromoCodeSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string
) =>
  z
    .object({
      code: z
        .string()
        .min(2, t('minLength', { min: 2 }))
        .max(50, t('maxLength', { max: 50 }))
        .regex(PROMO_CODE_REGEX, t('promoCodeFormat')),
      description: z.string().max(500).optional().or(z.literal('')),
      type: promoCodeTypeSchema,
      value: z.number().min(0.01, t('minValue', { min: 0.01 })),
      minimumAmount: z.number().min(0).nullable(),
      maxUsageCount: z.number().int().min(1).nullable(),
      startsAt: z.date().nullable(),
      expiresAt: z.date().nullable(),
      isActive: z.boolean(),
    })
    .refine(
      (data) => (data.type === 'percentage' ? data.value <= 100 : true),
      { message: t('maxPercentage', { max: 100 }), path: ['value'] }
    )
    .refine(
      (data) =>
        data.startsAt && data.expiresAt ? data.expiresAt > data.startsAt : true,
      { message: t('expiresAfterStarts'), path: ['expiresAt'] }
    )

/** Server-side schema (no i18n needed) */
export const promoCodeServerSchema = z
  .object({
    code: z.string().min(2).max(50).regex(PROMO_CODE_REGEX),
    description: z.string().max(500).optional().or(z.literal('')),
    type: promoCodeTypeSchema,
    value: z.number().min(0.01),
    minimumAmount: z.number().min(0).nullable(),
    maxUsageCount: z.number().int().min(1).nullable(),
    startsAt: z.date().nullable(),
    expiresAt: z.date().nullable(),
    isActive: z.boolean(),
  })
  .refine(
    (data) => (data.type === 'percentage' ? data.value <= 100 : true),
    { message: 'Percentage must be between 0 and 100', path: ['value'] }
  )
  .refine(
    (data) =>
      data.startsAt && data.expiresAt ? data.expiresAt > data.startsAt : true,
    { message: 'End date must be after start date', path: ['expiresAt'] }
  )

export type PromoCodeFormValues = z.infer<typeof promoCodeServerSchema>

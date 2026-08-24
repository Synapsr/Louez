import { z } from 'zod';

import { AI_ADVISOR_PRODUCT_CONTEXT_MAX_LENGTH } from './ai-advisor';
import { imageUrlSchema as storedImageUrlSchema } from './image';

// Image URL validation - allows public URLs, same-origin stored assets and
// legacy base64 data URIs.
// Note: base64 is allowed for backwards compatibility with old products,
// but new uploads should go through S3
const isProductImageUrl = (url: string) => {
  if (url.startsWith('data:image/')) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const imageUrlSchema = z
  .string()
  .refine(
    isProductImageUrl,
    'Invalid image URL. Must be a valid stored image URL or image data URI.',
  );

export const productImageVersionSchema = z.object({
  id: z.string().min(1).max(128),
  url: imageUrlSchema,
  kind: z.enum(['original', 'cropped', 'ai-enhanced', 'background-removed']),
  createdAt: z.iso.datetime().optional(),
});

export const productImageHistorySchema = z.object({
  id: z.string().min(1).max(128),
  versions: z.array(productImageVersionSchema).min(1).max(50),
});

// Pricing tier schema
export const pricingTierSchema = z.object({
  id: z.string().optional(),
  minDuration: z.number().int().min(1, 'La durée minimum doit être au moins 1'),
  discountPercent: z
    .number()
    .min(0, 'La réduction ne peut pas être négative')
    .max(99, 'La réduction ne peut pas dépasser 99%'),
});

export const durationUnitSchema = z.enum(['minute', 'hour', 'day', 'week']);

export const priceDurationSchema = z.object({
  price: z
    .string()
    .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
    .refine(
      (price) => Number.parseFloat(price.replace(',', '.')) > 0,
      'validation.positive',
    ),
  duration: z.number().int().min(1, 'validation.minValue'),
  unit: durationUnitSchema,
});

export const rateTierSchema = z.object({
  id: z.string().optional(),
  price: z.string().regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive'),
  duration: z.number().int().min(1, 'validation.minValue'),
  unit: durationUnitSchema,
  // UI-only, derived value. Never persisted in DB.
  discountPercent: z.number().min(0).max(99).optional(),
});

const optionalMoneyInputSchema = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
  .optional()
  .nullable()
  .or(z.literal(''));

const optionalDateInputSchema = z
  .union([
    z.date(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
    z.literal(''),
  ])
  .optional()
  .nullable();

// Tax settings schema for product
export const productTaxSettingsSchema = z.object({
  inheritFromStore: z.boolean(),
  customRate: z.number().min(0).max(100).optional(),
});

const productUnitBaseSchema = z.object({
  identifier: z.string().max(255, 'validation.maxLength'),
  attributes: z.record(z.string(), z.string()).optional(),
  hasActiveAssignment: z.boolean().optional(),
});

const newProductUnitDetailsSchema = z.object({
  notes: z.string().max(1000).optional().or(z.literal('')),
  purchasePrice: optionalMoneyInputSchema,
  purchasedAt: optionalDateInputSchema,
  images: z.array(z.string().max(2048)).max(4).optional(),
});

// Product unit schema for individual unit tracking
// Note: identifier min length is NOT enforced here — it's conditionally validated
// via .superRefine() on the parent schema only when trackUnits is true.
export const productUnitSchema = z.union([
  productUnitBaseSchema.extend({
    id: z.string().min(1),
  }),
  productUnitBaseSchema.extend({
    id: z.undefined().optional(),
    ...newProductUnitDetailsSchema.shape,
  }),
]);

export const bookingAttributeAxisSchema = z.object({
  key: z
    .string()
    .min(1, 'validation.required')
    .max(32, 'validation.maxLength')
    .regex(/^[a-z0-9_-]+$/, 'validation.invalidFormat'),
  label: z
    .string()
    .min(1, 'validation.required')
    .max(50, 'validation.maxLength'),
  position: z.number().int().min(0),
});

export type PricingTierInput = z.infer<typeof pricingTierSchema>;
export type PriceDurationInput = z.infer<typeof priceDurationSchema>;
export type RateTierInput = z.infer<typeof rateTierSchema>;
export type ProductUnitInput = z.infer<typeof productUnitSchema>;
export type BookingAttributeAxisInput = z.infer<
  typeof bookingAttributeAxisSchema
>;

function priceDurationToMinutes(
  duration: number,
  unit: 'minute' | 'hour' | 'day' | 'week',
): number {
  switch (unit) {
    case 'minute':
      return duration;
    case 'hour':
      return duration * 60;
    case 'day':
      return duration * 60 * 24;
    case 'week':
      return duration * 60 * 24 * 7;
    default:
      return duration;
  }
}

function hasDuplicateRateTierPeriods(
  rateTiers: Array<{
    duration: number;
    unit: 'minute' | 'hour' | 'day' | 'week';
  }>,
): boolean {
  const periods = new Set<number>();
  for (const tier of rateTiers) {
    const period = priceDurationToMinutes(tier.duration, tier.unit);
    if (periods.has(period)) {
      return true;
    }
    periods.add(period);
  }
  return false;
}

function ignoreDurationPricingForFixed(input: unknown): unknown {
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  if (!parsed.success || parsed.data.pricingKind !== 'fixed') {
    return input;
  }

  return {
    ...parsed.data,
    basePriceDuration: undefined,
    pricingTiers: [],
    rateTiers: [],
    enforceStrictTiers: false,
  };
}

const moneyInputRegex = /^\d+([.,]\d{1,2})?$/;

function isPositiveMoneyInput(value: string): boolean {
  return Number.parseFloat(value.replace(',', '.')) > 0;
}

// Schema factory that accepts translation function
// YouTube URL validation regex
const youtubeUrlRegex =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/;

export const createProductSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z
    .object({
      name: z
        .string()
        .min(2, t('minLength', { min: 2 }))
        .max(255, t('maxLength', { max: 255 })),
      description: z.string(),
      aiContext: z
        .string()
        .max(
          AI_ADVISOR_PRODUCT_CONTEXT_MAX_LENGTH,
          t('maxLength', { max: AI_ADVISOR_PRODUCT_CONTEXT_MAX_LENGTH }),
        ),
      categoryIds: z.array(z.string()),
      price: z
        .string()
        .regex(/^\d+([.,]\d{1,2})?$/, t('positive'))
        .or(z.literal('')),
      deposit: z
        .string()
        .regex(/^\d+([.,]\d{1,2})?$/, t('positive'))
        .or(z.literal('')),
      quantity: z.string().regex(/^\d+$/, t('integer')),
      status: z.enum(['draft', 'active', 'archived']),
      images: z.array(
        z.string().refine(isProductImageUrl, t('invalidImageUrl')),
      ),
      imageHistory: z.array(productImageHistorySchema).max(5),
      pricingKind: z.enum(['duration', 'fixed']),
      pricingMode: z.enum(['hour', 'day', 'week']),
      // Kept structurally required so the form can hold on to a base period
      // while the user edits a fixed price; its content is only validated for
      // duration pricing (see the superRefine below).
      basePriceDuration: z.object({
        price: z.string(),
        duration: z.number(),
        unit: z.enum(['minute', 'hour', 'day', 'week']),
      }),
      pricingTiers: z.array(
        z.object({
          id: z.string().optional(),
          minDuration: z
            .number()
            .int()
            .min(1, t('minValue', { min: 1 })),
          discountPercent: z
            .number()
            .min(0, t('minValue', { min: 0 }))
            .max(99, t('maxValue', { max: 99 })),
        }),
      ),
      rateTiers: z.array(
        z.object({
          id: z.string().optional(),
          price: z.string().regex(/^\d+([.,]\d{1,2})?$/, t('positive')),
          duration: z
            .number()
            .int()
            .min(1, t('minValue', { min: 1 })),
          unit: z.enum(['minute', 'hour', 'day', 'week']),
          discountPercent: z
            .number()
            .min(0, t('minValue', { min: 0 }))
            .max(99, t('maxValue', { max: 99 }))
            .optional(),
        }),
      ),
      enforceStrictTiers: z.boolean(),
      taxSettings: productTaxSettingsSchema,
      videoUrl: z
        .string()
        .regex(youtubeUrlRegex, t('invalidYoutubeUrl'))
        .or(z.literal('')),
      accessoryIds: z.array(z.string()),
      // Unit tracking
      trackUnits: z.boolean(),
      units: z.array(
        z.union([
          z.object({
            id: z.string().min(1),
            identifier: z.string().max(255, t('maxLength', { max: 255 })),
            attributes: z.record(z.string(), z.string()).optional(),
            hasActiveAssignment: z.boolean().optional(),
          }),
          z.object({
            id: z.undefined().optional(),
            identifier: z.string().max(255, t('maxLength', { max: 255 })),
            notes: z
              .string()
              .max(1000, t('maxLength', { max: 1000 }))
              .optional()
              .or(z.literal('')),
            purchasePrice: optionalMoneyInputSchema,
            purchasedAt: optionalDateInputSchema,
            images: z.array(z.string().max(2048)).max(4).optional(),
            attributes: z.record(z.string(), z.string()).optional(),
            hasActiveAssignment: z.boolean().optional(),
          }),
        ]),
      ),
      bookingAttributeAxes: z
        .array(
          z.object({
            key: z
              .string()
              .min(1, t('required'))
              .max(32, t('maxLength', { max: 32 }))
              .regex(/^[a-z0-9_-]+$/, t('invalidFormat')),
            label: z
              .string()
              .min(1, t('required'))
              .max(50, t('maxLength', { max: 50 })),
            position: z.number().int().min(0),
          }),
        )
        .max(3, t('maxItems', { max: 3 })),
    })
    .superRefine((data, ctx) => {
      if (data.pricingKind === 'fixed') {
        if (!data.price || !isPositiveMoneyInput(data.price)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('positive'),
            path: ['price'],
          });
        }
      } else {
        const baseRate = data.basePriceDuration;

        if (
          !moneyInputRegex.test(baseRate.price) ||
          !isPositiveMoneyInput(baseRate.price)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('positive'),
            path: ['basePriceDuration', 'price'],
          });
        }

        if (!Number.isInteger(baseRate.duration) || baseRate.duration < 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('minValue', { min: 1 }),
            path: ['basePriceDuration', 'duration'],
          });
        }
      }

      const axes = data.bookingAttributeAxes || [];
      const normalizedAxisKeys = axes.map((axis) =>
        axis.key.trim().toLowerCase(),
      );
      const duplicateKeys = normalizedAxisKeys.filter(
        (key, index) => normalizedAxisKeys.indexOf(key) !== index,
      );

      if (duplicateKeys.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('duplicateValue'),
          path: ['bookingAttributeAxes'],
        });
      }

      if (!data.trackUnits && axes.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('invalidData'),
          path: ['bookingAttributeAxes'],
        });
      }

      if (data.trackUnits && data.units) {
        for (let i = 0; i < data.units.length; i++) {
          if (!data.units[i].identifier || !data.units[i].identifier.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t('required'),
              path: ['units', i, 'identifier'],
            });
          }

          if (axes.length > 0) {
            for (const axis of axes) {
              const value = data.units[i].attributes?.[axis.key];
              if (!value || !value.trim()) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: t('required'),
                  path: ['units', i, 'attributes', axis.key],
                });
              }
            }
          }
        }
      }

      if (
        data.rateTiers &&
        data.rateTiers.length > 0 &&
        hasDuplicateRateTierPeriods(data.rateTiers)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('duplicateValue'),
          path: ['rateTiers'],
        });
      }
    });

export const createCategorySchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(255, t('maxLength', { max: 255 })),
    description: z.string().optional().nullable(),
    imageUrl: storedImageUrlSchema.optional().nullable(),
  });

// Default schemas for server-side validation
export const productSchema = z
  .preprocess(ignoreDurationPricingForFixed, z.object({
    name: z
      .string()
      .min(2, 'validation.minLength')
      .max(255, 'validation.maxLength'),
    description: z.string().optional(),
    aiContext: z
      .string()
      .max(AI_ADVISOR_PRODUCT_CONTEXT_MAX_LENGTH, 'validation.maxLength')
      .optional(),
    // Legacy single category (kept for API/MCP backward compatibility).
    categoryId: z.string().optional().nullable(),
    categoryIds: z.array(z.string()).optional(),
    price: z
      .string()
      .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
      .or(z.literal('')),
    deposit: z
      .string()
      .regex(/^\d+([.,]\d{1,2})?$/, 'validation.positive')
      .optional()
      .or(z.literal('')),
    quantity: z.string().regex(/^\d+$/, 'validation.integer'),
    status: z.enum(['draft', 'active', 'archived']),
    images: z.array(imageUrlSchema).optional(),
    imageHistory: z.array(productImageHistorySchema).max(5).optional(),
    pricingKind: z.enum(['duration', 'fixed']).default('duration'),
    pricingMode: z.enum(['hour', 'day', 'week']),
    basePriceDuration: priceDurationSchema.optional(),
    pricingTiers: z.array(pricingTierSchema).optional(),
    rateTiers: z.array(rateTierSchema).optional(),
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
    bookingAttributeAxes: z
      .array(bookingAttributeAxisSchema)
      .max(3, 'validation.maxItems')
      .optional(),
  }))
  .superRefine((data, ctx) => {
    if (data.pricingKind === 'fixed') {
      if (!data.price || !isPositiveMoneyInput(data.price)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'validation.positive',
          path: ['price'],
        });
      }
    } else if (!data.basePriceDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validation.required',
        path: ['basePriceDuration'],
      });
    }

    const axes = data.bookingAttributeAxes || [];
    const normalizedAxisKeys = axes.map((axis) =>
      axis.key.trim().toLowerCase(),
    );
    const duplicateKeys = normalizedAxisKeys.filter(
      (key, index) => normalizedAxisKeys.indexOf(key) !== index,
    );

    if (duplicateKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validation.duplicateValue',
        path: ['bookingAttributeAxes'],
      });
    }

    if (!data.trackUnits && axes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validation.invalidData',
        path: ['bookingAttributeAxes'],
      });
    }

    if (data.trackUnits && data.units) {
      for (let i = 0; i < data.units.length; i++) {
        if (!data.units[i].identifier || !data.units[i].identifier.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'validation.required',
            path: ['units', i, 'identifier'],
          });
        }

        if (axes.length > 0) {
          for (const axis of axes) {
            const value = data.units[i].attributes?.[axis.key];
            if (!value || !value.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'validation.required',
                path: ['units', i, 'attributes', axis.key],
              });
            }
          }
        }
      }
    }

    if (
      data.rateTiers &&
      data.rateTiers.length > 0 &&
      hasDuplicateRateTierPeriods(data.rateTiers)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'validation.duplicateValue',
        path: ['rateTiers'],
      });
    }
  });

export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'validation.minLength')
    .max(255, 'validation.maxLength'),
  description: z.string().optional().nullable(),
  imageUrl: storedImageUrlSchema.optional().nullable(),
});

type ParsedProductInput = z.infer<typeof productSchema>;
export type ProductInput = Omit<
  ParsedProductInput,
  'basePriceDuration' | 'pricingKind'
> & {
  basePriceDuration: PriceDurationInput;
  pricingKind?: 'duration' | 'fixed';
};
export type CategoryInput = z.infer<typeof categorySchema>;

import { z } from 'zod'
import { isValidImageUrl } from './image'

const dateTimeOrDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))

export const storefrontAvailabilityInputSchema = z.object({
  startDate: dateTimeOrDateSchema,
  endDate: dateTimeOrDateSchema,
  productIds: z.array(z.string().length(21)).optional(),
})

export const storefrontResolveCombinationInputSchema = z.object({
  productId: z.string().length(21),
  quantity: z.number().int().min(1),
  startDate: dateTimeOrDateSchema,
  endDate: dateTimeOrDateSchema,
  selectedAttributes: z.record(z.string(), z.string()).optional(),
})

export const storefrontAvailabilityRouteQuerySchema = z.object({
  startDate: dateTimeOrDateSchema,
  endDate: dateTimeOrDateSchema,
  productIds: z.string().nullish(),
})

export const dashboardReservationPollInputSchema = z.object({})

export const updateStoreLegalInputSchema = z.object({
  cgv: z.string().max(100000, 'errors.invalidData').optional(),
  legalNotice: z.string().max(100000, 'errors.invalidData').optional(),
})

const s3UrlSchema = z
  .string()
  .refine(
    (url) => !url.startsWith('data:'),
    'Base64 images are not allowed. Please upload images to S3.',
  )
  .refine(
    (url) => isValidImageUrl(url),
    'Invalid image URL. Must be a valid S3 URL.',
  )

export const updateStoreAppearanceInputSchema = z.object({
  logoUrl: z.union([s3UrlSchema, z.literal(''), z.null()]).optional(),
  darkLogoUrl: z.union([s3UrlSchema, z.literal(''), z.null()]).optional(),
  theme: z
    .object({
      mode: z.enum(['light', 'dark']),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color'),
      heroImages: z.array(s3UrlSchema).max(5).optional(),
    })
    .optional(),
})

export const addressAutocompleteInputSchema = z.object({
  query: z.string().trim().min(3).max(200),
})

export const addressDetailsInputSchema = z.object({
  placeId: z.string().trim().min(1).max(255),
})

export const reservationSignInputSchema = z.object({
  reservationId: z.string().length(21),
})

export type StorefrontAvailabilityInput = z.infer<
  typeof storefrontAvailabilityInputSchema
>
export type StorefrontResolveCombinationInput = z.infer<
  typeof storefrontResolveCombinationInputSchema
>
export type DashboardReservationPollInput = z.infer<
  typeof dashboardReservationPollInputSchema
>
export type UpdateStoreLegalInput = z.infer<typeof updateStoreLegalInputSchema>
export type UpdateStoreAppearanceInput = z.infer<
  typeof updateStoreAppearanceInputSchema
>
export type AddressAutocompleteInput = z.infer<
  typeof addressAutocompleteInputSchema
>
export type AddressDetailsInput = z.infer<typeof addressDetailsInputSchema>
export type ReservationSignInput = z.infer<typeof reservationSignInputSchema>

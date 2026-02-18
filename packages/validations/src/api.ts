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

export const dashboardReservationsListInputSchema = z.object({
  status: z
    .enum([
      'all',
      'pending',
      'confirmed',
      'ongoing',
      'completed',
      'cancelled',
      'rejected',
    ])
    .optional(),
  period: z.enum(['today', 'week', 'month']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  search: z.string().max(100).optional(),
  sort: z.enum(['startDate', 'amount', 'status', 'number']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export const dashboardReservationGetByIdInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationUpdateNotesInputSchema = z.object({
  reservationId: z.string().length(21),
  notes: z.string().max(100000).default(''),
})

export const dashboardReservationUpdateStatusInputSchema = z.object({
  reservationId: z.string().length(21),
  status: z.enum([
    'pending',
    'confirmed',
    'ongoing',
    'completed',
    'cancelled',
    'rejected',
  ]),
  rejectionReason: z.string().max(2000).optional(),
})

export const dashboardReservationCancelInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationGetAvailableUnitsInputSchema = z.object({
  reservationItemId: z.string().length(21),
})

export const dashboardReservationAssignUnitsInputSchema = z.object({
  reservationItemId: z.string().length(21),
  unitIds: z.array(z.string().length(21)).max(500),
})

export const dashboardReservationRequestPaymentInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    type: z.enum(['rental', 'deposit', 'custom']),
    amount: z.number().min(0.5).optional(),
    channels: z.object({
      email: z.boolean(),
      sms: z.boolean(),
    }),
    customMessage: z.string().max(5000).optional(),
  }),
})

export const dashboardReservationGetPaymentMethodInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationRecordPaymentInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    type: z.enum(['rental', 'deposit', 'deposit_return', 'damage', 'adjustment']),
    amount: z.number(),
    method: z.enum(['cash', 'card', 'transfer', 'check', 'other']),
    paidAt: z.union([dateTimeOrDateSchema, z.date()]).optional(),
    notes: z.string().max(10000).optional(),
  }),
})

export const dashboardReservationDeletePaymentInputSchema = z.object({
  paymentId: z.string().length(21),
})

export const dashboardReservationReturnDepositInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    amount: z.number().min(0.01),
    method: z.enum(['cash', 'card', 'transfer', 'check', 'other']),
    notes: z.string().max(10000).optional(),
  }),
})

export const dashboardReservationRecordDamageInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    amount: z.number().min(0.01),
    method: z.enum(['cash', 'card', 'transfer', 'check', 'other']),
    notes: z.string().max(10000),
  }),
})

export const dashboardReservationCreateDepositHoldInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationCaptureDepositHoldInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    amount: z.number().min(0.01),
    reason: z.string().trim().min(1).max(10000),
  }),
})

export const dashboardReservationReleaseDepositHoldInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationSendReservationEmailInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    templateId: z.string().trim().min(1).max(100),
    customSubject: z.string().max(500).optional(),
    customMessage: z.string().max(100000).optional(),
  }),
})

export const dashboardReservationSendAccessLinkInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationSendAccessLinkSmsInputSchema = z.object({
  reservationId: z.string().length(21),
})

export const dashboardReservationUpdateReservationInputSchema = z.object({
  reservationId: z.string().length(21),
  payload: z.object({
    startDate: z.union([dateTimeOrDateSchema, z.date()]).optional(),
    endDate: z.union([dateTimeOrDateSchema, z.date()]).optional(),
    items: z
      .array(
        z.object({
          id: z.string().length(21).optional(),
          productId: z.string().length(21).nullable().optional(),
          quantity: z.number().int().min(1),
          unitPrice: z.number(),
          depositPerUnit: z.number().min(0),
          isManualPrice: z.boolean().optional(),
          pricingMode: z.enum(['hour', 'day', 'week']).optional(),
          productSnapshot: z.object({
            name: z.string().trim().min(1).max(500),
            description: z.string().max(100000).nullable().optional(),
            images: z.array(z.string().max(2048)).optional(),
          }),
        }),
      )
      .optional(),
  }),
})

export const dashboardReservationCreateManualReservationInputSchema = z.object({
  payload: z.object({
    customerId: z.string().length(21).optional(),
    newCustomer: z
      .object({
        email: z.string().email().max(320),
        firstName: z.string().trim().min(1).max(200),
        lastName: z.string().trim().min(1).max(200),
        phone: z.string().trim().max(50).optional(),
      })
      .optional(),
    startDate: z.union([dateTimeOrDateSchema, z.date()]),
    endDate: z.union([dateTimeOrDateSchema, z.date()]),
    items: z.array(
      z.object({
        productId: z.string().length(21),
        quantity: z.number().int().min(1),
        selectedAttributes: z.record(z.string(), z.string()).optional(),
        priceOverride: z
          .object({
            unitPrice: z.number().min(0),
          })
          .optional(),
      }),
    ),
    customItems: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(500),
          description: z.string().max(100000),
          unitPrice: z.number(),
          deposit: z.number().min(0),
          quantity: z.number().int().min(1),
          pricingMode: z.enum(['hour', 'day', 'week']),
        }),
      )
      .optional(),
    internalNotes: z.string().max(100000).optional(),
    sendConfirmationEmail: z.boolean().optional(),
  }),
})

export const updateStoreLegalInputSchema = z.object({
  cgv: z.string().max(100000, 'errors.invalidData').optional(),
  legalNotice: z.string().max(100000, 'errors.invalidData').optional(),
  includeFullCgvInContract: z.boolean().optional(),
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

export const dashboardIntegrationsGetTulipStateInputSchema = z.object({})

export const dashboardIntegrationsConnectTulipInputSchema = z.object({
  apiKey: z.string().trim().min(8).max(500),
})

export const dashboardIntegrationsUpdateTulipConfigurationInputSchema = z.object({
  publicMode: z.enum(['required', 'optional', 'no_public']),
  includeInFinalPrice: z.boolean(),
  renterUid: z.string().trim().min(1).max(50).nullable(),
  contractType: z.enum(['LCD', 'LMD', 'LLD']),
})

export const dashboardIntegrationsUpsertTulipProductMappingInputSchema = z.object({
  productId: z.string().length(21),
  tulipProductId: z.string().trim().min(1).max(50).nullable(),
})

const tulipProductTypeSchema = z.enum([
  'bike',
  'wintersports',
  'watersports',
  'event',
  'high-tech',
  'small-tools',
])

const tulipProductSubtypeSchema = z.enum([
  'standard',
  'electric',
  'cargo',
  'remorque',
  'furniture',
  'tent',
  'decorations',
  'tableware',
  'entertainment',
  'action-cam',
  'drone',
  'camera',
  'video-camera',
  'stabilizer',
  'phone',
  'computer',
  'tablet',
  'small-appliance',
  'large-appliance',
  'construction-equipment',
  'diy-tools',
  'electric-diy-tools',
  'gardening-tools',
  'electric-gardening-tools',
  'kitesurf',
  'foil',
  'windsurf',
  'sailboat',
  'kayak',
  'canoe',
  'water-ski',
  'wakeboard',
  'mono-ski',
  'buoy',
  'paddle',
  'surf',
  'pedalo',
  'ski',
  'snowboard',
  'snowshoe',
])

const tulipPurchasedDateSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
])

export const dashboardIntegrationsPushTulipProductUpdateInputSchema = z.object({
  productId: z.string().length(21),
  title: z.string().trim().max(255).nullable().optional(),
  productType: tulipProductTypeSchema.nullable().optional(),
  productSubtype: tulipProductSubtypeSchema.nullable().optional(),
  purchasedDate: tulipPurchasedDateSchema.nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(1_000_000).nullable().optional(),
})

export const dashboardIntegrationsCreateTulipProductInputSchema = z.object({
  productId: z.string().length(21),
  title: z.string().trim().max(255).nullable().optional(),
  productType: tulipProductTypeSchema.nullable().optional(),
  productSubtype: tulipProductSubtypeSchema.nullable().optional(),
  purchasedDate: tulipPurchasedDateSchema.nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(1_000_000).nullable().optional(),
})

export const dashboardIntegrationsDisconnectTulipInputSchema = z.object({})

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
export type DashboardReservationsListInput = z.infer<
  typeof dashboardReservationsListInputSchema
>
export type DashboardReservationGetByIdInput = z.infer<
  typeof dashboardReservationGetByIdInputSchema
>
export type DashboardReservationUpdateNotesInput = z.infer<
  typeof dashboardReservationUpdateNotesInputSchema
>
export type DashboardReservationUpdateStatusInput = z.infer<
  typeof dashboardReservationUpdateStatusInputSchema
>
export type DashboardReservationCancelInput = z.infer<
  typeof dashboardReservationCancelInputSchema
>
export type DashboardReservationGetAvailableUnitsInput = z.infer<
  typeof dashboardReservationGetAvailableUnitsInputSchema
>
export type DashboardReservationAssignUnitsInput = z.infer<
  typeof dashboardReservationAssignUnitsInputSchema
>
export type DashboardReservationRequestPaymentInput = z.infer<
  typeof dashboardReservationRequestPaymentInputSchema
>
export type DashboardReservationGetPaymentMethodInput = z.infer<
  typeof dashboardReservationGetPaymentMethodInputSchema
>
export type DashboardReservationRecordPaymentInput = z.infer<
  typeof dashboardReservationRecordPaymentInputSchema
>
export type DashboardReservationDeletePaymentInput = z.infer<
  typeof dashboardReservationDeletePaymentInputSchema
>
export type DashboardReservationReturnDepositInput = z.infer<
  typeof dashboardReservationReturnDepositInputSchema
>
export type DashboardReservationRecordDamageInput = z.infer<
  typeof dashboardReservationRecordDamageInputSchema
>
export type DashboardReservationCreateDepositHoldInput = z.infer<
  typeof dashboardReservationCreateDepositHoldInputSchema
>
export type DashboardReservationCaptureDepositHoldInput = z.infer<
  typeof dashboardReservationCaptureDepositHoldInputSchema
>
export type DashboardReservationReleaseDepositHoldInput = z.infer<
  typeof dashboardReservationReleaseDepositHoldInputSchema
>
export type DashboardReservationSendReservationEmailInput = z.infer<
  typeof dashboardReservationSendReservationEmailInputSchema
>
export type DashboardReservationSendAccessLinkInput = z.infer<
  typeof dashboardReservationSendAccessLinkInputSchema
>
export type DashboardReservationSendAccessLinkSmsInput = z.infer<
  typeof dashboardReservationSendAccessLinkSmsInputSchema
>
export type DashboardReservationUpdateReservationInput = z.infer<
  typeof dashboardReservationUpdateReservationInputSchema
>
export type DashboardReservationCreateManualReservationInput = z.infer<
  typeof dashboardReservationCreateManualReservationInputSchema
>
export type UpdateStoreLegalInput = z.infer<typeof updateStoreLegalInputSchema>
export type UpdateStoreAppearanceInput = z.infer<
  typeof updateStoreAppearanceInputSchema
>
export type DashboardIntegrationsGetTulipStateInput = z.infer<
  typeof dashboardIntegrationsGetTulipStateInputSchema
>
export type DashboardIntegrationsConnectTulipInput = z.infer<
  typeof dashboardIntegrationsConnectTulipInputSchema
>
export type DashboardIntegrationsUpdateTulipConfigurationInput = z.infer<
  typeof dashboardIntegrationsUpdateTulipConfigurationInputSchema
>
export type DashboardIntegrationsUpsertTulipProductMappingInput = z.infer<
  typeof dashboardIntegrationsUpsertTulipProductMappingInputSchema
>
export type DashboardIntegrationsPushTulipProductUpdateInput = z.infer<
  typeof dashboardIntegrationsPushTulipProductUpdateInputSchema
>
export type DashboardIntegrationsDisconnectTulipInput = z.infer<
  typeof dashboardIntegrationsDisconnectTulipInputSchema
>
export type AddressAutocompleteInput = z.infer<
  typeof addressAutocompleteInputSchema
>
export type AddressDetailsInput = z.infer<typeof addressDetailsInputSchema>
export type ReservationSignInput = z.infer<typeof reservationSignInputSchema>

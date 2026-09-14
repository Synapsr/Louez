import { z } from "zod";

const emailSchema = (message: string) => z.string().trim().toLowerCase().pipe(z.email(message));

export const reservationStatusSchema = z.enum([
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
  "declined",
]);

// Schema factories that accept translation function
export const createReservationItemSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z.object({
    productId: z.string().min(1, t("required")),
    quantity: z.number().min(1, t("minValue", { min: 1 })),
  });

export const createManualReservationSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z.object({
    // Customer
    customerType: z.enum(["existing", "new"]),
    customerId: z.string().optional(),
    email: emailSchema(t("email")).optional(),
    firstName: z.string().min(1, t("required")).optional(),
    lastName: z.string().min(1, t("required")).optional(),
    phone: z.string().optional(),

    // Dates
    startDate: z.date({ message: t("required") }),
    endDate: z.date({ message: t("required") }),

    // Items
    items: z.array(createReservationItemSchema(t)).min(1, t("required")),

    // Notes
    internalNotes: z.string().optional(),
  });

// Default schemas for server-side validation
export const reservationItemSchema = z.object({
  productId: z.string().min(1, "validation.required"),
  quantity: z.number().min(1, "validation.minValue"),
});

export const manualReservationSchema = z.object({
  // Customer
  customerType: z.enum(["existing", "new"]),
  customerId: z.string().optional(),
  email: emailSchema("validation.email").optional(),
  firstName: z.string().min(1, "validation.required").optional(),
  lastName: z.string().min(1, "validation.required").optional(),
  phone: z.string().optional(),

  // Dates
  startDate: z.date({ message: "validation.required" }),
  endDate: z.date({ message: "validation.required" }),

  // Items
  items: z.array(reservationItemSchema).min(1, "validation.required"),

  // Notes
  internalNotes: z.string().optional(),
});

export const updateReservationNotesSchema = z.object({
  internalNotes: z.string().optional(),
});

export type ReservationStatus = z.infer<typeof reservationStatusSchema>;
export type ReservationItem = z.infer<typeof reservationItemSchema>;
export type ManualReservationInput = z.infer<typeof manualReservationSchema>;

// ============================================================================
// Storefront checkout: createReservation input (public boundary)
// ============================================================================

const RESERVATION_ID_REGEX = /^[A-Za-z0-9_-]{21}$/;

/** Optional free text: trimmed and capped; "" is accepted and read as absent. */
const optionalReservationText = (max: number) => z.string().trim().max(max).optional();

/** Any string `Date` can parse (the cart stores `toISOString()` values). */
const reservationDateTimeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), "validation.invalidDate");

const reservationAttributesSchema = z.record(z.string().min(1).max(100), z.string().max(255));

export const reservationLocaleSchema = z.enum(["fr", "en", "it", "nl", "pt", "de", "es", "pl"]);

export const createReservationCustomerSchema = z.object({
  email: emailSchema("validation.email").pipe(z.string().max(320)),
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  phone: optionalReservationText(50),
  customerType: z.enum(["individual", "business"]).optional(),
  companyName: optionalReservationText(255),
  /** SIREN (FR) / BCE (BE). Absent keeps the invoice B2C. */
  companyNumber: optionalReservationText(64),
  vatNumber: optionalReservationText(64),
  address: optionalReservationText(500),
  city: optionalReservationText(255),
  postalCode: optionalReservationText(20),
});

export const createReservationLineSchema = z.object({
  lineId: optionalReservationText(128),
  productId: z.string().trim().min(1).max(64),
  selectedAttributes: reservationAttributesSchema.optional(),
  resolvedCombinationKey: optionalReservationText(255),
  resolvedAttributes: reservationAttributesSchema.optional(),
  quantity: z.number().int().min(1).max(999),
  startDate: reservationDateTimeSchema,
  endDate: reservationDateTimeSchema,
  /** Client estimate, only used for mismatch monitoring. */
  unitPrice: z.number().min(0),
  /** Client estimate, only used for mismatch monitoring. */
  depositPerUnit: z.number().min(0),
});

export const createReservationDeliveryLegSchema = z.object({
  method: z.enum(["store", "address"]),
  locationId: z.string().trim().max(64).nullish(),
  address: optionalReservationText(500),
  city: optionalReservationText(255),
  postalCode: optionalReservationText(20),
  country: optionalReservationText(100),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

/**
 * Public checkout payload. `source`, `reservationId`, `marketplaceSecret` and
 * the product snapshot are deliberately absent: the server fixes the source,
 * builds the snapshot from the catalog and only trusted callers (marketplace
 * facade, phone receptionist) reach the internal function with more.
 */
export const createReservationInputSchema = z.object({
  storeId: z.string().trim().min(1).max(64),
  customer: createReservationCustomerSchema,
  items: z.array(createReservationLineSchema).min(1).max(50),
  customerNotes: optionalReservationText(2000),
  /** Client estimates, only used for mismatch monitoring. */
  subtotalAmount: z.number().min(0),
  depositAmount: z.number().min(0),
  totalAmount: z.number().min(0),
  tulipInsuranceOptIn: z.boolean().optional(),
  locale: reservationLocaleSchema.optional(),
  delivery: z
    .object({
      outbound: createReservationDeliveryLegSchema,
      return: createReservationDeliveryLegSchema,
    })
    .optional(),
  promoCode: optionalReservationText(50),
  advisorConversationId: z.string().regex(RESERVATION_ID_REGEX).optional(),
  /**
   * Pending online reservation of a previous attempt by the same customer.
   * Reused as-is when the cart is unchanged, cancelled when it differs.
   */
  resumeReservationId: z.string().regex(RESERVATION_ID_REGEX).optional(),
});

/** `storefront.promo.validate`: the code plus the cart lines to price server-side. */
export const storefrontPromoValidateInputSchema = z.object({
  code: z.string().trim().min(1).max(50),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(64),
        quantity: z.number().int().min(1).max(999),
        startDate: reservationDateTimeSchema,
        endDate: reservationDateTimeSchema,
      }),
    )
    .min(1)
    .max(50),
});

export const storefrontPromoValidateOutputSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    promo: z.object({
      id: z.string(),
      code: z.string(),
      type: z.enum(["percentage", "fixed"]),
      value: z.number(),
      discountAmount: z.number(),
      minimumAmount: z.number(),
      subtotal: z.number(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    errorParams: z.record(z.string(), z.string()).optional(),
  }),
]);

export type CreateReservationInput = z.infer<typeof createReservationInputSchema>;
export type CreateReservationCustomerInput = z.infer<typeof createReservationCustomerSchema>;
export type CreateReservationLineInput = z.infer<typeof createReservationLineSchema>;
export type CreateReservationDeliveryLegInput = z.infer<typeof createReservationDeliveryLegSchema>;
export type ReservationLocale = z.infer<typeof reservationLocaleSchema>;
export type StorefrontPromoValidateInput = z.infer<typeof storefrontPromoValidateInputSchema>;
export type StorefrontPromoValidateOutput = z.infer<typeof storefrontPromoValidateOutputSchema>;

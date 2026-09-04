import { z } from "zod";

const bookingAttributesSchema = z.record(z.string(), z.string());

const bookingCustomerSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
    firstName: z.string().trim().min(1).max(255),
    lastName: z.string().trim().min(1).max(255),
    phone: z.string().trim().min(1).max(50).optional(),
    marketplaceUserId: z.string().trim().min(1).max(255).optional(),
    customerType: z.enum(["individual", "business"]).optional(),
    companyName: z.string().trim().min(1).max(255).optional(),
    companyNumber: z.string().trim().min(1).max(64).optional(),
    vatNumber: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((customer, context) => {
    if (customer.customerType === "business" && !customer.companyName) {
      context.addIssue({
        code: "custom",
        message: "companyName is required for business customers",
        path: ["companyName"],
      });
    }
  });

const bookingItemSchema = z
  .object({
    productId: z.string().length(21),
    quantity: z.number().int().min(1).max(999),
    attributes: z.record(z.string().min(1).max(100), z.string().max(255)).optional(),
  })
  .strict();

const bookingWindowSchema = z
  .object({
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((value) => new Date(value.endAt) > new Date(value.startAt), {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });

export const bookingAvailabilityInputSchema = z
  .object({
    storeId: z.string().length(21),
    items: z
      .array(
        z
          .object({
            productId: z.string().length(21),
            quantity: z.number().int().min(1).max(999),
            attributes: bookingAttributesSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    windows: z.array(bookingWindowSchema).min(1).max(7),
  })
  .strict();

export const bookingCalendarInputSchema = z
  .object({
    storeId: z.string().length(21),
    productId: z.string().length(21),
    attributes: bookingAttributesSchema.optional(),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .strict()
  .refine((value) => value.to >= value.from, {
    message: "to must be on or after from",
    path: ["to"],
  })
  .refine(
    (value) =>
      (Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) /
        86_400_000 <=
      93,
    {
      message: "date range must not exceed 93 days",
      path: ["to"],
    },
  );

export const bookingQuoteInputSchema = z
  .object({
    storeId: z.string().length(21),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    locale: z.enum(["fr", "en", "de", "es", "it", "nl", "pl", "pt"]),
    items: z.array(bookingItemSchema).min(1).max(100),
  })
  .strict()
  .refine((value) => new Date(value.endAt) > new Date(value.startAt), {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });

export const bookingHoldInputSchema = z
  .object({
    quoteToken: z.string().min(1).max(32_768),
    bookingAttemptId: z.uuid(),
    customer: bookingCustomerSchema,
  })
  .strict();

export const bookingCheckoutInputSchema = z
  .object({
    holdId: z.string().length(21),
    bookingAttemptId: z.uuid(),
    successUrl: z.url({ protocol: /^https?$/ }),
    cancelUrl: z.url({ protocol: /^https?$/ }),
  })
  .strict();

export const bookingReservationParamsSchema = z.object({
  reservationId: z.string().length(21),
});

export const bookingListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const bookingCancelInputSchema = z.object({}).strict();

export const bookingSignInputSchema = z
  .object({
    // End-customer IP forwarded by the marketplace so the recorded signature
    // points at the person who signed, not at the marketplace server.
    signatureIp: z.string().trim().min(3).max(64).optional(),
  })
  .strict();

export const bookingAccessLinkInputSchema = z
  .object({
    target: z.enum(["reservation", "contract"]).default("reservation"),
  })
  .strict();

export const bookingContractQuerySchema = z.object({
  lang: z.enum(["fr", "en"]).default("fr"),
});

export type BookingQuoteInput = z.infer<typeof bookingQuoteInputSchema>;
export type BookingAvailabilityInput = z.infer<typeof bookingAvailabilityInputSchema>;
export type BookingCalendarInput = z.infer<typeof bookingCalendarInputSchema>;
export type BookingHoldInput = z.infer<typeof bookingHoldInputSchema>;
export type BookingCheckoutInput = z.infer<typeof bookingCheckoutInputSchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
export type BookingSignInput = z.infer<typeof bookingSignInputSchema>;
export type BookingAccessLinkInput = z.infer<typeof bookingAccessLinkInputSchema>;

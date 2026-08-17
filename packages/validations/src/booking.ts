import { z } from "zod";

const bookingItemSchema = z
  .object({
    productId: z.string().length(21),
    quantity: z.number().int().min(1).max(999),
    attributes: z.record(z.string().min(1).max(100), z.string().max(255)).optional(),
  })
  .strict();

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
    customer: z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
        firstName: z.string().trim().min(1).max(255),
        lastName: z.string().trim().min(1).max(255),
        phone: z.string().trim().min(1).max(50).optional(),
        marketplaceUserId: z.string().trim().min(1).max(255).optional(),
      })
      .strict(),
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

export type BookingQuoteInput = z.infer<typeof bookingQuoteInputSchema>;
export type BookingHoldInput = z.infer<typeof bookingHoldInputSchema>;
export type BookingCheckoutInput = z.infer<typeof bookingCheckoutInputSchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

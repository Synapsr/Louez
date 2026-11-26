import { z } from "zod";

export const extensionReasonSchema = z.enum([
  "disabled",
  "insurance",
  "manualPrice",
  "unpaid",
  "delivery",
  "deposit",
  "overdue",
  "location",
]);
export type ExtensionReason = z.infer<typeof extensionReasonSchema>;
export type ExtensionPreview =
  | { mode: "manual"; reason: ExtensionReason }
  | { mode: "automatic"; supplement: number; total: number; currency: string; endDate: string };

const nullableMoney = z.string().nullable();
export const extensionAttemptSchema = z.object({
  kind: z.literal("rental_extension"),
  status: z.enum(["checkout", "confirmed", "refund_pending", "refunded", "cancelled"]),
  requestedEndMs: z.number().finite(),
  expiresMs: z.number().finite(),
  fingerprint: z.string(),
  originalEndDate: z.string(),
  supplement: z.number().nonnegative(),
  currency: z.string(),
  sessionId: z.string().optional(),
  /**
   * What the session was created to charge, in the currency's minor units: its
   * completion compares Stripe's amount with it. Absent on an attempt whose session
   * was created without it, whose completion takes what Stripe charged.
   */
  sessionChargeMinor: z.number().int().nonnegative().optional(),
  paymentId: z.string().optional(),
  effectsDone: z.boolean().optional(),
  effectsClaimUntil: z.number().optional(),
  nextReconcileMs: z.number().optional(),
  plan: z.object({
    subtotalAmount: z.string(),
    totalAmount: z.string(),
    subtotalExclTax: nullableMoney,
    taxAmount: nullableMoney,
    taxRate: nullableMoney,
    // The mode the plan's amounts were computed with, written with them; absent
    // from a plan made before it was recorded (slice 9).
    taxDisplayMode: z.enum(["inclusive", "exclusive"]).optional(),
    items: z.array(
      z.object({
        id: z.string(),
        pricingBreakdown: z
          .object({
            basePrice: z.number(),
            effectivePrice: z.number(),
            duration: z.number(),
            durationMinutes: z.number(),
            pricingMode: z.enum(["hour", "day", "week"]),
            pricingKind: z.enum(["duration", "fixed"]),
            discountPercent: z.number().nullable(),
            discountAmount: z.number(),
            tierApplied: z.string().nullable(),
            // The line's recorded promotion, carried through as stored (slice 9);
            // absent when the line recorded none.
            promotion: z
              .object({
                percentage: z.number(),
                originalSubtotal: z.number(),
                discountAmount: z.number(),
              })
              .nullable()
              .optional(),
            taxRate: z.number().nullable(),
            taxAmount: z.number().nullable(),
            subtotalExclTax: z.number().nullable(),
            subtotalInclTax: z.number().nullable(),
          })
          .optional(),
        unitPrice: z.string(),
        totalPrice: z.string(),
        taxRate: nullableMoney,
        taxAmount: nullableMoney,
        priceExclTax: nullableMoney,
        totalExclTax: nullableMoney,
        taxExempt: z.boolean().optional(),
      }),
    ),
  }),
});
export type ExtensionAttempt = z.infer<typeof extensionAttemptSchema>;

export const getExtensionAttempt = (metadata: unknown): ExtensionAttempt | null => {
  const result = extensionAttemptSchema.safeParse(metadata);
  return result.success ? result.data : null;
};

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
      }),
    ),
  }),
});
export type ExtensionAttempt = z.infer<typeof extensionAttemptSchema>;

export const getExtensionAttempt = (metadata: unknown): ExtensionAttempt | null => {
  const result = extensionAttemptSchema.safeParse(metadata);
  return result.success ? result.data : null;
};

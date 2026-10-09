import { z } from "zod";

const checkoutFailureSchema = z.object({
  source: z.literal("checkout_payment_failed"),
  reason: z.enum(["amount_too_small", "session_creation_failed"]),
  minimumAmount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
});

export type CheckoutFailure = z.infer<typeof checkoutFailureSchema>;

export const getCheckoutFailure = (
  status: string,
  activities: Array<{ activityType: string; metadata: unknown }>,
): CheckoutFailure | null => {
  if (status !== "cancelled") return null;
  const cancellation = activities.find((activity) => activity.activityType === "cancelled");
  const result = checkoutFailureSchema.safeParse(cancellation?.metadata);
  return result.success ? result.data : null;
};

import { z } from "zod";

import { ORPCError } from "@orpc/server";

import { dashboardProcedure } from "../../procedures";
import { toORPCError } from "../../utils/orpc-error";

const payoutCursorSchema = z
  .string()
  .max(255)
  .regex(/^po_[A-Za-z0-9]+$/);

const payoutSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(["paid", "pending", "in_transit", "failed", "canceled", "unknown"]),
  createdAt: z.number(),
  arrivalAt: z.number(),
  destinationLast4: z.string().nullable(),
});

const payouts = dashboardProcedure
  .input(z.object({ cursor: payoutCursorSchema.optional() }))
  .output(
    z.object({
      items: z.array(payoutSchema),
      nextCursor: z.string().nullable(),
    }),
  )
  .handler(async ({ context, input }) => {
    try {
      const fn = context.getConnectedAccountPayoutPage;
      if (!fn) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "getConnectedAccountPayoutPage not provided in context",
        });
      }

      const { stripeAccountId, stripeChargesEnabled } = context.store;
      if (!stripeAccountId || !stripeChargesEnabled) {
        throw new ORPCError("FORBIDDEN", {
          message: "errors.noStripeAccount",
        });
      }

      return await fn({ accountId: stripeAccountId, cursor: input.cursor });
    } catch (error) {
      throw toORPCError(error);
    }
  });

export const dashboardPaymentsRouter = {
  payouts,
};

import { z } from "zod";

import { handoffLinkSchema } from "./handoffs";
import { resourceLinksSchema } from "./links";

/** The store's Stripe account, as Stripe last told Louez, and what it means for bookings. */
export const stripeStatusSchema = z.object({
  /** The store has a Stripe account (connected, or still being set up). */
  connected: z.boolean(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  /** What Stripe still asks for, by its own field names. */
  requirements: z.object({
    currentlyDue: z.array(z.string()),
    pastDue: z.array(z.string()),
    eventuallyDue: z.array(z.string()),
  }),
  /**
   * The booking mode the store chose, and the one its storefront applies:
   * payment mode takes requests until Stripe can charge (ADR 0004).
   */
  bookingMode: z.object({
    intended: z.enum(["payment", "request"]),
    effective: z.enum(["payment", "request"]),
  }),
  links: resourceLinksSchema,
});
export type StripeStatus = z.infer<typeof stripeStatusSchema>;

export const startStripeOnboardingInput = z.object({});
export const startStripeOnboardingOutput = handoffLinkSchema;
export const openStripeDashboardInput = z.object({});
export const openStripeDashboardOutput = handoffLinkSchema;
export const syncStripeStatusInput = z.object({});
export const syncStripeStatusOutput = stripeStatusSchema;

"use server";

import { z } from "zod";

import {
  resumeCheckoutPayment as resumeCheckoutPaymentForStore,
  type ResumeCheckoutPaymentResult,
} from "@/lib/reservations/resume-checkout-payment";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

const resumeInputSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  reservationId: z.string().trim().min(1).max(64),
});

export type { ResumeCheckoutPaymentResult };

/** Primary action of the cancelled page: back to Stripe, same reservation. */
export const resumeCheckoutPayment = async (
  rawInput: z.input<typeof resumeInputSchema>,
): Promise<ResumeCheckoutPaymentResult> => {
  const parsed = resumeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "not_found" };
  }
  const { slug, reservationId } = parsed.data;

  const store = await getStoreBySlug(slug);
  if (!store) {
    return { ok: false, error: "not_found" };
  }

  return resumeCheckoutPaymentForStore({ store, reservationId });
};

import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, payments, reservations } from "@louez/db";

import { log } from "@/lib/evlog";
import { createReservationPaymentSessionForCustomer } from "@/lib/reservations/payment-session";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { getCheckoutSession } from "@/lib/stripe";

export type ResumeCheckoutPaymentResult =
  | { ok: true; url: string }
  | {
      ok: false;
      error: "not_found" | "invalid_status" | "payment_unavailable" | "session_failed";
    };

interface ResumeCheckoutPaymentStore {
  id: string;
  slug: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean | null;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Send the customer back to Stripe for a pending online checkout. The open
 * session is reused when Stripe still holds it (same amount, same lines);
 * after its 30-minute expiry a new one is created for the same charge.
 *
 * Shared by the cancelled page (the customer clicks "resume") and by the
 * checkout itself (the customer re-submits an unchanged cart).
 */
export const resumeCheckoutPayment = async ({
  store,
  reservationId,
}: {
  store: ResumeCheckoutPaymentStore;
  reservationId: string;
}): Promise<ResumeCheckoutPaymentResult> => {
  if (!store.stripeAccountId || !store.stripeChargesEnabled) {
    return { ok: false, error: "payment_unavailable" };
  }

  const reservation = await db.query.reservations.findFirst({
    columns: { id: true, status: true, customerId: true, source: true },
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
  });
  if (!reservation || reservation.source !== "online") {
    return { ok: false, error: "not_found" };
  }
  if (reservation.status !== "pending") {
    return { ok: false, error: "invalid_status" };
  }

  // The checkout's own payment row: its amount is the charge the customer saw
  // (a partial deposit or the full total) and its session may still be open.
  const checkoutPayment = await db.query.payments.findFirst({
    columns: { amount: true, status: true, stripeCheckoutSessionId: true },
    where: and(eq(payments.reservationId, reservationId), eq(payments.type, "rental")),
    orderBy: desc(payments.createdAt),
  });
  if (!checkoutPayment?.stripeCheckoutSessionId) {
    return { ok: false, error: "invalid_status" };
  }

  if (checkoutPayment.status === "pending") {
    try {
      const session = await getCheckoutSession(
        store.stripeAccountId,
        checkoutPayment.stripeCheckoutSessionId,
      );
      if (session.status === "open" && session.url) {
        return { ok: true, url: session.url };
      }
    } catch (error) {
      log.warn("checkout-resume", `session lookup failed: ${describeError(error)}`);
    }
  }

  const result = await createReservationPaymentSessionForCustomer(
    store.slug,
    reservationId,
    reservation.customerId,
    "checkout_resume",
    {
      allowPendingReservation: true,
      chargeAmount: Number.parseFloat(checkoutPayment.amount),
      successUrl: getStorefrontUrl(store.slug, `/checkout/return?reservation=${reservationId}`),
      cancelUrl: getStorefrontUrl(store.slug, `/checkout/cancelled?reservation=${reservationId}`),
    },
  );

  if ("error" in result) {
    return { ok: false, error: "session_failed" };
  }
  if (!result.paymentUrl) {
    return { ok: false, error: "invalid_status" };
  }
  return { ok: true, url: result.paymentUrl };
};

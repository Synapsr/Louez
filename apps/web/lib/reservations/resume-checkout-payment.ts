import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { checkoutSessionRowIn, db, payments, reservations } from "@louez/db";
import type { StoreSettings } from "@louez/types";

import { log } from "@/lib/evlog";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { createReservationPaymentSessionForCustomer } from "@/lib/reservations/payment-session";
import { getRentalBalance, rentalChargeRefusal } from "@/lib/reservations/util.rental-amount";
import { getStorefrontUrl } from "@/lib/storefront-url";
import { getCheckoutSession } from "@/lib/stripe";

export type ResumeCheckoutPaymentResult =
  | { ok: true; url: string }
  | {
      ok: false;
      /**
       * `already_paid`: nothing remains of the rental. `reservation_changed`: part
       * of it was paid, or its total moved, since the checkout: the reservation's
       * page says where it stands.
       */
      error:
        | "not_found"
        | "invalid_status"
        | "payment_unavailable"
        | "already_paid"
        | "reservation_changed"
        | "session_failed";
    }
  /** Below the card minimum of its currency, as the checkout says it. */
  | { ok: false; error: "amount_too_small"; minimumAmount: number; currency: string };

interface ResumeCheckoutPaymentStore {
  id: string;
  slug: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean | null;
  settings: Pick<StoreSettings, "currency"> | null;
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
    columns: {
      id: true,
      status: true,
      customerId: true,
      source: true,
      totalAmount: true,
      currency: true,
    },
    where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
    // What settles the rental (`getRentalBalance`), for the open session's charge.
    with: { payments: true },
  });
  if (!reservation || reservation.source !== "online") {
    return { ok: false, error: "not_found" };
  }
  if (reservation.status !== "pending") {
    return { ok: false, error: "invalid_status" };
  }

  // The checkout's own payment row: its amount is the charge the customer saw
  // (a partial deposit or the full total) and its session may still be open. A
  // payment request's row is the store's request, not the checkout.
  const checkoutPayment = await db.query.payments.findFirst({
    columns: { amount: true, status: true, stripeCheckoutSessionId: true },
    where: and(eq(payments.reservationId, reservationId), checkoutSessionRowIn(payments)),
    orderBy: desc(payments.createdAt),
  });
  if (!checkoutPayment?.stripeCheckoutSessionId) {
    return { ok: false, error: "invalid_status" };
  }

  // The open session is handed back only while its charge still fits the
  // balance, by the rule a new session follows (`rentalChargeRefusal`): never
  // above what remains, never once part of the rental is paid.
  const chargeAmount = Number.parseFloat(checkoutPayment.amount);
  const currency = reservationCurrency(reservation.currency, store.settings);
  const chargeFits =
    rentalChargeRefusal(
      getRentalBalance(reservation, currency),
      { amount: chargeAmount, fixed: true },
      currency,
    ) === null;

  if (checkoutPayment.status === "pending" && chargeFits) {
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
      chargeAmount,
      successUrl: getStorefrontUrl(store.slug, `/checkout/return?reservation=${reservationId}`),
      cancelUrl: getStorefrontUrl(store.slug, `/checkout/cancelled?reservation=${reservationId}`),
    },
  );

  if ("error" in result) {
    // A session of the rental was found paid (and recorded, when it could be).
    if (result.error === "errors.alreadyPaid") return { ok: false, error: "already_paid" };
    if (result.error === "errors.reservationChangedMeanwhile") {
      return { ok: false, error: "reservation_changed" };
    }
    if ("errorParams" in result && result.errorParams) {
      return { ok: false, error: "amount_too_small", ...result.errorParams };
    }
    return { ok: false, error: "session_failed" };
  }
  if (!result.paymentUrl) {
    return { ok: false, error: "invalid_status" };
  }
  return { ok: true, url: result.paymentUrl };
};

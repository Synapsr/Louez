import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { hasReservationCustomerSession } from "@/lib/customer-auth/reservation-session";
import { log } from "@/lib/evlog";
import { completeCheckoutPayment } from "@/lib/reservations/complete-checkout-payment";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const returnQuerySchema = z.object({
  reservation: z.string().trim().min(1).max(64),
  session_id: z.string().trim().min(1).max(255),
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Stripe's `success_url` of the storefront checkout: completes the payment,
 * then lands the customer. Payment completion does not verify ownership of
 * the checkout email, so the return opens no session: only a customer
 * already signed in as the reservation's customer lands on the reservation;
 * anyone else lands on the paid page, which shows nothing of the customer.
 */
export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await params;
  const query = returnQuerySchema.safeParse({
    reservation: request.nextUrl.searchParams.get("reservation"),
    session_id: request.nextUrl.searchParams.get("session_id"),
  });

  if (!query.success) {
    return NextResponse.redirect(getStorefrontUrl(slug, "/"));
  }

  const store = await getStoreBySlug(slug);
  if (!store) {
    return NextResponse.redirect(getStorefrontUrl(slug, "/"));
  }

  const { reservation: reservationId, session_id: sessionId } = query.data;

  // Both landings say whether the payment is recorded yet, so a completion
  // the webhook finishes later lands on the same page.
  const paidLanding = async () => {
    const signedIn = await hasReservationCustomerSession(store.id, reservationId).catch(
      () => false,
    );
    const path = signedIn
      ? `/account/reservations/${reservationId}?event=paid`
      : `/checkout/paid?reservation=${encodeURIComponent(reservationId)}&session_id=${encodeURIComponent(sessionId)}`;
    return NextResponse.redirect(getStorefrontUrl(slug, path));
  };

  try {
    const result = await completeCheckoutPayment({
      source: "return",
      storeId: store.id,
      reservationId,
      stripeCheckoutSessionId: sessionId,
    });

    if (result.status === "not_paid") {
      return NextResponse.redirect(
        getStorefrontUrl(slug, `/checkout/cancelled?reservation=${reservationId}`),
      );
    }

    if (result.status !== "completed") {
      return NextResponse.redirect(getStorefrontUrl(slug, "/"));
    }
  } catch (error) {
    // The webhook finishes the job; the landing says the payment is being confirmed.
    log.error("checkout-return", `completion failed: ${describeError(error)}`);
  }

  return paidLanding();
};

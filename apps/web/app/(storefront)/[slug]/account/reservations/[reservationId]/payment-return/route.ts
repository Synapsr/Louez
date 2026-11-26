import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { env } from "@/env";
import { log } from "@/lib/evlog";
import { completeCheckoutPayment } from "@/lib/reservations/complete-checkout-payment";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const returnSchema = z.object({
  // A reservation id: 21 URL-safe characters, nothing a path could be built from.
  reservationId: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
  sessionId: z.string().trim().min(1).max(255),
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Stripe's `success_url` of the customer's own payment of the rental
 * (`createReservationPaymentSessionForCustomer`). The store is resolved first,
 * and every redirect is built from its own slug; an unknown store sends to the
 * instance's root. The session is verified at Stripe and its payment recorded
 * (`completeCheckoutPayment`, once, whichever of this return and the webhook
 * comes first): only a session read on this store's account, whose metadata
 * names this reservation (and this store, when the metadata carries it), of a
 * reservation of this store, that Stripe reports paid. The customer then lands on
 * the reservation, with the paid event and the session only once its payment is
 * recorded: an unpaid, expired or foreign session, or a return Louez could not
 * finish, lands there without it, so no banner claims a payment.
 */
export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; reservationId: string }> },
) => {
  const { slug, reservationId } = await params;
  const store = await getStoreBySlug(slug);
  if (!store) {
    return NextResponse.redirect(new URL("/", env.NEXT_PUBLIC_APP_URL));
  }

  const query = returnSchema.safeParse({
    reservationId,
    sessionId: request.nextUrl.searchParams.get("session_id"),
  });
  if (!query.success) {
    return NextResponse.redirect(getStorefrontUrl(store.slug, "/account"));
  }

  const reservationPath = `/account/reservations/${query.data.reservationId}`;
  const { sessionId } = query.data;
  let recorded = false;
  try {
    const completion = await completeCheckoutPayment({
      source: "return",
      storeId: store.id,
      reservationId: query.data.reservationId,
      stripeCheckoutSessionId: sessionId,
    });
    recorded = completion.status === "completed";
  } catch (error) {
    // The webhook records it; the landing claims nothing meanwhile.
    log.error("payment-return", `completion failed: ${describeError(error)}`);
  }

  return NextResponse.redirect(
    getStorefrontUrl(
      store.slug,
      recorded
        ? `${reservationPath}?event=paid&session_id=${encodeURIComponent(sessionId)}`
        : reservationPath,
    ),
  );
};

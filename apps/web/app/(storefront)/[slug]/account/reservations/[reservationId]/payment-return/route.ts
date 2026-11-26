import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { log } from "@/lib/evlog";
import { completeCheckoutPayment } from "@/lib/reservations/complete-checkout-payment";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const returnSchema = z.object({
  reservationId: z.string().length(21),
  sessionId: z.string().trim().min(1).max(255),
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Stripe's `success_url` of the customer's own payment of the rental
 * (`createReservationPaymentSessionForCustomer`): the session is verified at
 * Stripe and its payment recorded (`completeCheckoutPayment`, once, whichever
 * of this return and the webhook comes first), then the customer lands on the
 * reservation, whose banner reads that session's payment: received, or still
 * being verified. The landing asserts nothing the completion did not record.
 */
export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; reservationId: string }> },
) => {
  const { slug, reservationId } = await params;
  const query = returnSchema.safeParse({
    reservationId,
    sessionId: request.nextUrl.searchParams.get("session_id"),
  });
  if (!query.success) {
    return NextResponse.redirect(getStorefrontUrl(slug, "/account"));
  }

  const store = await getStoreBySlug(slug);
  if (!store) {
    return NextResponse.redirect(getStorefrontUrl(slug, "/"));
  }

  const { sessionId } = query.data;
  try {
    await completeCheckoutPayment({
      source: "return",
      storeId: store.id,
      reservationId,
      stripeCheckoutSessionId: sessionId,
    });
  } catch (error) {
    // The webhook records it: the banner says it is being verified meanwhile.
    log.error("payment-return", `completion failed: ${describeError(error)}`);
  }

  return NextResponse.redirect(
    getStorefrontUrl(
      slug,
      `/account/reservations/${reservationId}?event=paid&session_id=${encodeURIComponent(sessionId)}`,
    ),
  );
};

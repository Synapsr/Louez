import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

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

// Payment completion does not verify ownership of the checkout email.
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
  const reservationPath = `/account/reservations/${reservationId}`;

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

    return NextResponse.redirect(getStorefrontUrl(slug, `${reservationPath}?event=paid`));
  } catch (error) {
    // The webhook finishes the job; the customer still lands on the reservation.
    log.error("checkout-return", `completion failed: ${describeError(error)}`);
    return NextResponse.redirect(getStorefrontUrl(slug, reservationPath));
  }
};

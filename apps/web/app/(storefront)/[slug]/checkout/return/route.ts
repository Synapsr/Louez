import { NextResponse, type NextRequest } from "next/server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, reservations } from "@louez/db";

import { log } from "@/lib/evlog";
import { completeCheckoutPayment } from "@/lib/reservations/complete-checkout-payment";
import {
  INSTANT_ACCESS_SHORT_TTL_MS,
  createReservationInstantAccessUrl,
} from "@/lib/customer-auth/instant-access";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const returnQuerySchema = z.object({
  reservation: z.string().trim().min(1).max(64),
  session_id: z.string().trim().min(1).max(255),
});

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Stripe `success_url` of the storefront checkout. Runs the shared completion
 * chain (the webhook may already have done it: the claim is idempotent), then
 * sends the customer to the reservation page through a single-use short token
 * so no login stands between the payment and its confirmation.
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
  const reservationPath = `/account/reservations/${reservationId}`;

  try {
    const result = await completeCheckoutPayment({
      source: "return",
      storeId: store.id,
      reservationId,
      stripeCheckoutSessionId: sessionId,
    });

    if (result.status === "not_found") {
      return NextResponse.redirect(getStorefrontUrl(slug, "/"));
    }

    if (result.status === "not_paid") {
      return NextResponse.redirect(
        getStorefrontUrl(slug, `/checkout/cancelled?reservation=${reservationId}`),
      );
    }

    const reservation = await db.query.reservations.findFirst({
      columns: { id: true },
      where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
      with: { customer: { columns: { email: true } } },
    });

    if (!reservation) {
      return NextResponse.redirect(getStorefrontUrl(slug, "/"));
    }

    const accessUrl = await createReservationInstantAccessUrl({
      storeId: store.id,
      storeSlug: store.slug,
      customerEmail: reservation.customer.email,
      reservationId,
      redirectPath: `${reservationPath}?event=paid`,
      ttlMs: INSTANT_ACCESS_SHORT_TTL_MS,
    });

    return NextResponse.redirect(accessUrl);
  } catch (error) {
    // The webhook finishes the job; the customer still lands on the reservation.
    log.error("checkout-return", `completion failed: ${describeError(error)}`);
    return NextResponse.redirect(getStorefrontUrl(slug, reservationPath));
  }
};

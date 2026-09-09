import { NextResponse, type NextRequest } from "next/server";

import { getStorefrontUrl } from "@/lib/storefront-url";

import { confirmDepositAuthorization } from "../actions";

/**
 * Stripe `return_url` of the deposit hold. Reached only when a card needed a
 * redirect (3DS off-page): the intent is then re-read and recorded here,
 * before the customer lands on the reservation page. Any other visit is an
 * old link: same destination, without the event.
 */
export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; reservationId: string }> },
) => {
  const { slug, reservationId } = await params;
  const query = request.nextUrl.searchParams;
  const token = query.get("token");
  const paymentIntentId = query.get("payment_intent");
  const redirectStatus = query.get("redirect_status");

  if (token && paymentIntentId && redirectStatus === "succeeded") {
    const result = await confirmDepositAuthorization({
      slug,
      reservationId,
      token,
      paymentIntentId,
    });
    if (result.ok) {
      return NextResponse.redirect(result.redirectUrl);
    }
  }

  return NextResponse.redirect(
    getStorefrontUrl(slug, `/account/reservations/${encodeURIComponent(reservationId)}`),
  );
};

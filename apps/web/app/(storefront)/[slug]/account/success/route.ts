import { NextResponse, type NextRequest } from "next/server";

import { consumeReservationInstantAccess } from "@/lib/customer-auth/instant-access";
import { issueCustomerSession } from "@/lib/customer-auth/session";
import {
  ACCOUNT_PATH,
  buildLoginPath,
  type LoginErrorCode,
  type ReservationOutcomeEvent,
} from "@/lib/customer-auth/util.account-redirect";
import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

const EVENT_BY_TYPE: Record<string, ReservationOutcomeEvent> = {
  payment: "payment_received",
  deposit: "deposit_authorized",
};

/**
 * Legacy landing of the payment-request and deposit flows
 * (`/account/success?token&type&reservation`). Kept as a redirect only: it
 * opens the session and lands on the reservation page with the matching
 * `?event=`. WS-13 repoints its callers to `/r/{id}?token&redirect=`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get("token");
  const event = EVENT_BY_TYPE[searchParams.get("type") ?? ""];

  const toLogin = (error?: LoginErrorCode) =>
    NextResponse.redirect(getStorefrontUrl(slug, buildLoginPath({ error })));

  if (!token) return toLogin();

  try {
    const store = await getStoreBySlug(slug);
    if (!store) return toLogin("storeNotFound");

    const access = await consumeReservationInstantAccess({ storeId: store.id, token });
    if (!access.ok) return toLogin(access.error);

    const reservationPath = `${ACCOUNT_PATH}/reservations/${access.reservationId}`;
    const destination = event ? `${reservationPath}?event=${event}` : reservationPath;

    const cookie = await issueCustomerSession(access.customerId);
    const response = NextResponse.redirect(getStorefrontUrl(slug, destination));
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    log.error(
      "customer-auth",
      `success redirect failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return toLogin("verificationError");
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { consumeReservationInstantAccess } from "@/lib/customer-auth/instant-access";
import { issueCustomerSession } from "@/lib/customer-auth/session";
import {
  buildLoginPath,
  getInstantAccessRedirectPath,
  type LoginErrorCode,
} from "@/lib/customer-auth/util.account-redirect";
import { log } from "@/lib/evlog";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { getStorefrontUrl } from "@/lib/storefront-url";

/**
 * `/r/{reservationId}?token=…&redirect=…`: the auto-login link of emails,
 * SMS and the checkout return. A valid token opens a customer session and
 * lands on the reservation page (or its contract, or the page with one
 * `?event=`); anything else goes to the login page, which comes back here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; reservationId: string }> },
) {
  const { slug, reservationId } = await params;
  const token = request.nextUrl.searchParams.get("token");
  const redirectPath = getInstantAccessRedirectPath(
    request.nextUrl.searchParams.get("redirect"),
    reservationId,
  );

  const toLogin = (error?: LoginErrorCode) =>
    NextResponse.redirect(
      getStorefrontUrl(slug, buildLoginPath({ redirect: redirectPath, error })),
    );

  if (!token) return toLogin();

  try {
    const store = await getStoreBySlug(slug);
    if (!store) return toLogin("storeNotFound");

    const access = await consumeReservationInstantAccess({
      storeId: store.id,
      token,
      reservationId,
    });
    if (!access.ok) return toLogin(access.error);

    const cookie = await issueCustomerSession(access.customerId);
    const response = NextResponse.redirect(getStorefrontUrl(slug, redirectPath));
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    log.error(
      "customer-auth",
      `instant access failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return toLogin("verificationError");
  }
}

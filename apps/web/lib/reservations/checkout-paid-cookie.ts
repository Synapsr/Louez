import "server-only";

import { cookies } from "next/headers";

import { env as authEnv } from "@louez/auth/env";

import { isSecureCookieOrigin } from "@/lib/customer-auth/cookie";
import { getStorefrontUrl } from "@/lib/storefront-url";

import {
  CHECKOUT_PAID_COOKIE,
  type CheckoutPaidClaim,
  type CheckoutPaidCookieOptions,
  checkoutPaidCookieOptions,
  openCheckoutPaidClaim,
  sealCheckoutPaidClaim,
} from "./util.checkout-paid-claim";

/** The paid page of a store: no query, ever. */
export const checkoutPaidUrl = (slug: string): string => getStorefrontUrl(slug, "/checkout/paid");

/**
 * The cookie the checkout's return, and nothing else, sets once it knows the
 * page may be shown: the completion answered `completed`, or threw.
 */
export const buildCheckoutPaidCookie = (
  slug: string,
  claim: CheckoutPaidClaim,
): { name: string; value: string; options: CheckoutPaidCookieOptions } => ({
  name: CHECKOUT_PAID_COOKIE,
  value: sealCheckoutPaidClaim(claim, { secret: authEnv.AUTH_SECRET, now: new Date() }),
  options: checkoutPaidCookieOptions({
    paidUrl: checkoutPaidUrl(slug),
    secure: isSecureCookieOrigin(),
  }),
});

/** The claim this browser holds for `storeId`, or null: missing, forged, expired or another store's. */
export const readCheckoutPaidClaim = async (storeId: string): Promise<CheckoutPaidClaim | null> => {
  const jar = await cookies();
  const claim = openCheckoutPaidClaim(jar.get(CHECKOUT_PAID_COOKIE)?.value, {
    secret: authEnv.AUTH_SECRET,
    now: new Date(),
  });
  return claim?.storeId === storeId ? claim : null;
};

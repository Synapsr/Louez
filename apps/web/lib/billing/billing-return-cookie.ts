import { BILLING_RETURN_ORIGIN_COOKIE } from "@/lib/billing/billing-return";
import {
  BILLING_HANDOFF_PATH,
  type BillingReturnOrigin,
  readBillingReturnOrigin,
} from "@/lib/billing/billing-routes";

// Where a hand-off left from, kept from `GET /dashboard/billing` until its return
// (`/dashboard/billing/return`): the service's `return_url` carries no query (README §10
// step 4). The cookie holds no identity, only the Louez page to go back to.

/** A billing session lasts 2 hours at most (README §10): a later return follows a new hand-off. */
export const BILLING_RETURN_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60;

/** Sent only to the hand-off and the routes under it, the return among them. */
export const BILLING_RETURN_COOKIE_PATH = BILLING_HANDOFF_PATH;

export type BillingReturnCookieOptions = {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly maxAge: number;
  readonly path: string;
};

/** What the hand-off and its return use of `cookies()` from next/headers. */
export type BillingReturnCookieJar = {
  get(name: string): { readonly value: string } | undefined;
  set(name: string, value: string, options: BillingReturnCookieOptions): unknown;
  delete(cookie: { readonly name: string; readonly path: string }): unknown;
};

/**
 * Keeps `origin` until the return, or forgets an earlier hand-off's when null.
 * `dashboardOrigin` is Louez's: the cookie is `Secure` over HTTPS.
 */
export function rememberBillingReturnOrigin(
  jar: BillingReturnCookieJar,
  origin: BillingReturnOrigin | null,
  dashboardOrigin: string,
): void {
  if (origin) {
    jar.set(BILLING_RETURN_ORIGIN_COOKIE, origin, {
      httpOnly: true,
      secure: new URL(dashboardOrigin).protocol === "https:",
      sameSite: "lax",
      maxAge: BILLING_RETURN_COOKIE_MAX_AGE_SECONDS,
      path: BILLING_RETURN_COOKIE_PATH,
    });
  } else if (jar.get(BILLING_RETURN_ORIGIN_COOKIE)) {
    jar.delete({ name: BILLING_RETURN_ORIGIN_COOKIE, path: BILLING_RETURN_COOKIE_PATH });
  }
}

/** Where the return goes back to, read once: the cookie is cleared. */
export function takeBillingReturnOrigin(jar: BillingReturnCookieJar): BillingReturnOrigin | null {
  const stored = jar.get(BILLING_RETURN_ORIGIN_COOKIE);
  if (!stored) return null;
  jar.delete({ name: BILLING_RETURN_ORIGIN_COOKIE, path: BILLING_RETURN_COOKIE_PATH });
  return readBillingReturnOrigin(stored.value);
}

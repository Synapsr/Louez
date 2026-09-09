import "server-only";

import { env } from "@/env";

export const CUSTOMER_SESSION_COOKIE = "customer_session";

/** Customer sessions last 30 days (audit §5). */
export const CUSTOMER_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface CustomerSessionCookie {
  name: typeof CUSTOMER_SESSION_COOKIE;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    expires: Date;
    path: "/";
  };
}

/**
 * `secure` follows the public origin: an https app URL (or production) sets
 * it, plain-http local development does not. `lax` everywhere so the email
 * links (`/r/{id}?token`) and the Stripe return keep the session.
 */
const isSecureOrigin = (): boolean =>
  process.env.NODE_ENV === "production" || (env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");

export const buildCustomerSessionCookie = (
  value: string,
  expiresAt: Date,
): CustomerSessionCookie => ({
  name: CUSTOMER_SESSION_COOKIE,
  value,
  options: {
    httpOnly: true,
    secure: isSecureOrigin(),
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  },
});

import type { BetterAuthOptions } from "better-auth";

type RateLimitOptions = NonNullable<BetterAuthOptions["rateLimit"]>;
type IpAddressOptions = NonNullable<NonNullable<BetterAuthOptions["advanced"]>["ipAddress"]>;

/** Endpoints where each request is a guess at a secret (password, 6-digit code). */
const GUESS_RULE = { window: 60, max: 5 };

/** Endpoints that send an e-mail: slower, they can be used to flood a mailbox. */
const SEND_RULE = { window: 60, max: 3 };

/**
 * Rate limiting of `/api/auth/*` (SE-08). Counters live in `auth_rate_limits`
 * so every instance of the app shares them. Windows stay short on purpose: the
 * bucket is the client IP, which a whole shop (or a mobile carrier) can share —
 * a long quota would lock honest users out, a short throttle only slows a
 * guesser down. A 6-digit code is further capped at 3 tries by the OTP plugin.
 *
 * better-auth picks the FIRST key that matches, so exact paths must stay above
 * the wildcard that would otherwise swallow them.
 */
export const authRateLimitOptions = {
  // better-auth only turns rate limiting on in production by default; keeping
  // it on everywhere makes the limits testable before they ship.
  enabled: true,
  storage: "database",
  window: 60,
  max: 100,
  customRules: {
    "/sign-in/email": GUESS_RULE,
    "/sign-in/email-otp": GUESS_RULE,
    "/sign-up/email": GUESS_RULE,
    "/change-password": GUESS_RULE,
    "/sign-in/magic-link": SEND_RULE,
    "/email-otp/send-verification-otp": SEND_RULE,
    "/email-otp/request-password-reset": SEND_RULE,
    "/email-otp/request-email-change": SEND_RULE,
    "/forget-password/*": SEND_RULE,
    "/request-password-reset": SEND_RULE,
    "/send-verification-email": SEND_RULE,
    "/delete-user": SEND_RULE,
    "/email-otp/*": GUESS_RULE,
    "/reset-password": GUESS_RULE,
    "/reset-password/*": GUESS_RULE,
  },
} satisfies RateLimitOptions;

/**
 * Same precedence as `getClientIp` in the web app. better-auth only reads
 * `x-forwarded-for` by default and rejects it as soon as it holds a proxy
 * chain; every client would then share ONE bucket per path and a single
 * visitor could lock sign-in for everybody.
 */
export const authIpAddressOptions = {
  ipAddressHeaders: ["cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded-for"],
} satisfies IpAddressOptions;

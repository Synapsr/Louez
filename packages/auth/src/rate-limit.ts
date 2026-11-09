import type { BetterAuthOptions } from "better-auth";
import { getIP } from "better-auth/api";

import type { TrustedProxy } from "./env";
import { egressProviderOf } from "./provider-egress";

type RateLimitOptions = NonNullable<BetterAuthOptions["rateLimit"]>;
type IpAddressOptions = NonNullable<NonNullable<BetterAuthOptions["advanced"]>["ipAddress"]>;

type RateLimitRule = { window: number; max: number };

/** Endpoints where each request is a guess at a secret (password, 6-digit code). */
const GUESS_RULE = { window: 60, max: 5 };

/** Endpoints that send an e-mail: slower, they can be used to flood a mailbox. */
const SEND_RULE = { window: 60, max: 3 };

/**
 * Higher ceilings for the OAuth requests an AI platform's servers make for all
 * of its users at once: discovery, registration, token and UserInfo, from the
 * ranges Anthropic and OpenAI publish (`provider-egress.ts`). Any other
 * address keeps the endpoint's usual limit (Better Auth's OAuth provider sets
 * 20 token requests, 5 registrations and 60 UserInfo calls a minute; the
 * discovery documents have the default 100).
 *
 * Better Auth keys every counter by IP and path, before any rule runs, and has
 * no option for another key: a rule can change the ceiling, never the bucket.
 * So each address of a range gets the ceiling below, not the range as a whole.
 * The authorization endpoint is not here: the user's browser opens it, from
 * the user's own address.
 */
const PROVIDER_DISCOVERY_RULE = { window: 60, max: 600 };
const PROVIDER_EGRESS_RULES: Record<string, RateLimitRule> = {
  // Every path the discovery documents are served at, as Better Auth counts
  // them (a path under /api/auth without that prefix).
  "/.well-known/oauth-protected-resource": PROVIDER_DISCOVERY_RULE,
  "/.well-known/oauth-protected-resource/api/mcp": PROVIDER_DISCOVERY_RULE,
  "/.well-known/oauth-authorization-server": PROVIDER_DISCOVERY_RULE,
  "/.well-known/oauth-authorization-server/api/auth": PROVIDER_DISCOVERY_RULE,
  "/.well-known/openid-configuration": PROVIDER_DISCOVERY_RULE,
  "/oauth2/register": { window: 60, max: 60 },
  "/oauth2/token": { window: 60, max: 600 },
  "/oauth2/userinfo": { window: 60, max: 300 },
};

/** Better Auth's address reading, from Cloudflare's header alone. */
const CLOUDFLARE_ADDRESS_ONLY = {
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
} satisfies BetterAuthOptions;

/**
 * The platform a request comes from, or null. Only an ingress the instance
 * declares (`TRUSTED_PROXY`) can say it: behind Cloudflare, `cf-connecting-ip`
 * is the visitor's address, set by Cloudflare whatever the visitor sent. Every
 * other header (`true-client-ip`, `x-real-ip`, `x-forwarded-for`) can come from
 * the visitor, so it never raises a ceiling, and neither does a missing or
 * malformed `cf-connecting-ip`. Better Auth reads that header first and
 * checks it the same way (`authIpAddressOptions`), so an elevated request is
 * counted under the address it was elevated for.
 */
function requestEgressProvider(request: Request, trustedProxy: TrustedProxy | undefined) {
  if (trustedProxy !== "cloudflare") return null;
  return egressProviderOf(getIP(request, CLOUDFLARE_ADDRESS_ONLY));
}

function providerEgressRules(trustedProxy: TrustedProxy | undefined) {
  return Object.fromEntries(
    Object.entries(PROVIDER_EGRESS_RULES).map(([path, providerRule]) => [
      path,
      (request: Request, currentRule: RateLimitRule) =>
        requestEgressProvider(request, trustedProxy) ? providerRule : currentRule,
    ]),
  );
}

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
    "/passkey/generate-register-options": GUESS_RULE,
    "/passkey/verify-registration": GUESS_RULE,
    "/passkey/generate-authenticate-options": { window: 60, max: 20 },
    "/passkey/verify-authentication": { window: 60, max: 10 },
    "/passkey/delete-passkey": GUESS_RULE,
    "/passkey/update-passkey": GUESS_RULE,
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
 * The rate limit of an instance behind `trustedProxy` (`TRUSTED_PROXY`): the
 * rules above, and the AI platforms' ceilings, which only a declared ingress
 * can grant (`requestEgressProvider`). Unset, every address has the usual limits.
 */
export function authRateLimitOptionsBehind(trustedProxy: TrustedProxy | undefined) {
  return {
    ...authRateLimitOptions,
    customRules: { ...authRateLimitOptions.customRules, ...providerEgressRules(trustedProxy) },
  } satisfies RateLimitOptions;
}

/**
 * Same precedence as `getClientIp` in the web app. better-auth only reads
 * `x-forwarded-for` by default and rejects it as soon as it holds a proxy
 * chain; every client would then share ONE bucket per path and a single
 * visitor could lock sign-in for everybody.
 */
export const authIpAddressOptions = {
  ipAddressHeaders: ["cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded-for"],
} satisfies IpAddressOptions;

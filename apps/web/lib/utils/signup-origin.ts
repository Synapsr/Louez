/**
 * Where a sign-up came from, captured last-click from `?from=` and kept in a
 * cookie so it survives the auth round-trip (see `captureSignupOrigin` in
 * proxy.ts). Edge-safe on purpose: the proxy imports this module, so it must
 * stay free of `next/headers`, the database and any Node built-in.
 */

export const SIGNUP_ORIGIN_COOKIE = "louez_signup_origin";

/** 30-day attribution window, same as the referral cookie. */
export const SIGNUP_ORIGIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** The consumer marketplace that refers renters to Louez (ADR 010). */
export const REEENT_SIGNUP_ORIGIN = "reeent";

/**
 * Allow-list rather than a free-form string: the value is written to a cookie
 * from an untrusted query parameter and later drives what the UI promises.
 */
export const SIGNUP_ORIGINS = [REEENT_SIGNUP_ORIGIN] as const;

export type SignupOrigin = (typeof SIGNUP_ORIGINS)[number];

export function isKnownSignupOrigin(value: string | null | undefined): value is SignupOrigin {
  return typeof value === "string" && (SIGNUP_ORIGINS as readonly string[]).includes(value);
}

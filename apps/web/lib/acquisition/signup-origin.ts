import { cookies } from "next/headers";

import {
  isKnownSignupOrigin,
  REEENT_INTRO_SEEN_COOKIE,
  REEENT_SIGNUP_ORIGIN,
  SIGNUP_ORIGIN_COOKIE,
  SIGNUP_ORIGIN_COOKIE_MAX_AGE,
  type SignupOrigin,
} from "@/lib/utils/signup-origin";

/**
 * Server-side reader for the sign-up origin captured by the proxy (`?from=`).
 * Kept apart from `lib/utils/signup-origin` so the proxy can import the pure
 * constants without pulling `next/headers` into the edge bundle.
 */
export async function getSignupOrigin(): Promise<SignupOrigin | null> {
  const value = (await cookies()).get(SIGNUP_ORIGIN_COOKIE)?.value;
  return isKnownSignupOrigin(value) ? value : null;
}

/** True for loueurs who arrived from the reeent consumer marketplace. */
export async function isReeentSignupOrigin(): Promise<boolean> {
  return (await getSignupOrigin()) === REEENT_SIGNUP_ORIGIN;
}

/**
 * The reeent education step is a one-off: once acknowledged, the onboarding
 * gate stops sending the user back to it. Purely a UI marker — nothing about
 * eligibility or the cohort depends on it.
 */
export async function hasSeenReeentIntro(): Promise<boolean> {
  return (await cookies()).get(REEENT_INTRO_SEEN_COOKIE)?.value === "1";
}

/** Host-only cookie: the marker is only ever read on the dashboard host. */
export async function markReeentIntroSeen(): Promise<void> {
  (await cookies()).set(REEENT_INTRO_SEEN_COOKIE, "1", {
    maxAge: SIGNUP_ORIGIN_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

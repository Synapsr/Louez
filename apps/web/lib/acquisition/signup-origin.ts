import { cookies } from "next/headers";

import { and, eq, isNull } from "drizzle-orm";

import { db, users } from "@louez/db";

import {
  isKnownSignupOrigin,
  REEENT_SIGNUP_ORIGIN,
  SIGNUP_ORIGIN_COOKIE,
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

/**
 * Sign-up origin for a page that may be rendering the very request which
 * captured `?from=`: the proxy only writes the cookie to the outgoing response,
 * so `getSignupOrigin()` still reads nothing on that first render. Falling back
 * to the query parameter keeps the landing hit co-branded, while the cookie
 * covers later visits and the OAuth round-trip that drops the parameter.
 */
export async function resolveSignupOrigin(
  from: string | string[] | undefined,
): Promise<SignupOrigin | null> {
  const param = Array.isArray(from) ? from[0] : from;
  if (isKnownSignupOrigin(param)) return param;
  return getSignupOrigin();
}

/** Persist the first signup origin without allowing later visits to overwrite it. */
export async function persistSignupOrigin(userId: string): Promise<void> {
  const signupOrigin = await getSignupOrigin();
  if (signupOrigin === null) return;

  await db
    .update(users)
    .set({ signupOrigin, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.signupOrigin)));
}

/** True for loueurs who arrived from the reeent consumer marketplace. */
export async function isReeentSignupOrigin(): Promise<boolean> {
  return (await getSignupOrigin()) === REEENT_SIGNUP_ORIGIN;
}

/**
 * True for loueurs who arrived from reeent, whether or not the attribution
 * cookie is still around. The column is checked first because it is written on
 * the first authenticated request and outlives the 30-day cookie; the cookie
 * covers the window before that write, when the column is still null.
 */
export async function isReeentLoueur(
  user: { signupOrigin: string | null } | null | undefined,
): Promise<boolean> {
  if (user?.signupOrigin === REEENT_SIGNUP_ORIGIN) return true;
  return isReeentSignupOrigin();
}

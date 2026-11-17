import "server-only";

import { cookies } from "next/headers";

import { and, eq } from "drizzle-orm";

import { readTestModePass, TEST_MODE_COOKIE } from "@louez/api/services/test-reservation-token";
import { db, storeMembers, users } from "@louez/db";

import { env } from "@/env";

/**
 * The storefront's test mode (packages/db test-reservations.ts): a store member opened
 * the store from the dashboard (`/{slug}/test-mode?token=…`, which sets the signed
 * cookie), and every checkout of this browser books a test reservation for them.
 */
export interface StorefrontTestMode {
  /** The member who started the test: its messages go to them only. */
  userId: string;
  ownerEmail: string;
  ownerName: string | null;
}

/**
 * The member a pass names, if they are still a member of the store. Read on every
 * use: a member removed since the pass was signed loses the test mode at once.
 */
export async function findTestModeMember(
  storeId: string,
  userId: string,
): Promise<StorefrontTestMode | null> {
  const [member] = await db
    .select({ userId: users.id, email: users.email, name: users.name })
    .from(storeMembers)
    .innerJoin(users, eq(users.id, storeMembers.userId))
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, userId)))
    .limit(1);
  return member
    ? { userId: member.userId, ownerEmail: member.email, ownerName: member.name }
    : null;
}

/** The store's test mode in this browser, or null. Never trusts anything but the signed cookie. */
export async function getStorefrontTestMode(storeId: string): Promise<StorefrontTestMode | null> {
  const pass = readTestModePass((await cookies()).get(TEST_MODE_COOKIE)?.value, storeId);
  return pass ? findTestModeMember(storeId, pass.userId) : null;
}

/**
 * The cookie's options: httpOnly, lax (the dashboard's link opens the store), secure
 * on an https origin, on the host it is set on, scoped to the storefront's own path
 * (`/{slug}` on the dashboard host, `/` on the store's own host).
 */
export const testModeCookieOptions = (path: string, maxAgeSeconds: number) => ({
  httpOnly: true,
  secure:
    process.env.NODE_ENV === "production" || (env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://"),
  sameSite: "lax" as const,
  path,
  maxAge: maxAgeSeconds,
});

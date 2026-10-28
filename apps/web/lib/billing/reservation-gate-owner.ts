import { and, eq } from "drizzle-orm";

import { db, storeMembers } from "@louez/db";

import { auth } from "@/lib/auth";

/**
 * Whether the visitor is signed in to the dashboard as the store's owner, for the
 * storefront's owner-only banner. The dashboard's session cookie reaches the
 * storefront on the dashboard host (`/{slug}`) and on a standalone instance, not on a
 * store subdomain.
 */
export async function isSignedInStoreOwner(storeId: string): Promise<boolean> {
  const userId = (await auth())?.user?.id;
  if (!userId) return false;
  const [owner] = await db
    .select({ userId: storeMembers.userId })
    .from(storeMembers)
    .where(
      and(
        eq(storeMembers.storeId, storeId),
        eq(storeMembers.userId, userId),
        eq(storeMembers.role, "owner"),
      ),
    )
    .limit(1);
  return owner !== undefined;
}

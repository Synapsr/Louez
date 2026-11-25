import "server-only";

import { and, desc, eq, gt, isNotNull } from "drizzle-orm";

import { db, reservations, storeMembers, stores } from "@louez/db";

/**
 * The booking the visitor made last in their demo store: one written after
 * the store became theirs (the seeded ones are older). Null when the store is
 * not theirs any more, or they have not booked yet.
 */
export async function findLatestVisitorBooking(input: {
  userId: string;
  storeId: string;
  now?: Date;
}): Promise<{ id: string } | null> {
  const [store] = await db
    .select({ id: stores.id, claimedAt: stores.demoClaimedAt })
    .from(stores)
    .innerJoin(storeMembers, eq(storeMembers.storeId, stores.id))
    .where(
      and(
        eq(stores.id, input.storeId),
        eq(storeMembers.userId, input.userId),
        isNotNull(stores.demoVertical),
        gt(stores.demoExpiresAt, input.now ?? new Date()),
      ),
    )
    .limit(1);
  if (!store?.claimedAt) return null;

  const [booking] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.storeId, store.id), gt(reservations.createdAt, store.claimedAt)))
    .orderBy(desc(reservations.createdAt))
    .limit(1);
  return booking ?? null;
}

import { and, eq, isNull } from "drizzle-orm";

import { db, users } from "@louez/db";

import { type FirstTouch, firstTouchRecord } from "@/lib/acquisition/first-touch";
import { log } from "@/lib/evlog";

/**
 * Keeps a new account's first touch on its user row (`users.first_touch_attribution`),
 * for a later server-side ad conversion: once, never over an earlier one. Never throws:
 * a sign-up does not fail on its attribution.
 */
export async function persistFirstTouch(userId: string, touch: FirstTouch | null): Promise<void> {
  try {
    await db
      .update(users)
      .set({ firstTouchAttribution: firstTouchRecord(touch), updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.firstTouchAttribution)));
  } catch (error) {
    log.warn(
      "acquisition",
      `first touch of user ${userId} not kept: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

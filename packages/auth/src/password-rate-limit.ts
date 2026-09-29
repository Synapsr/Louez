import { eq, sql } from "drizzle-orm";

import { authRateLimits, db } from "@louez/db";

// Same 60-second window as the better-auth rules: its pruning of
// `auth_rate_limits` drops rows idle for longer, so a longer window here
// would silently lose its counter.
const PASSWORD_OPERATION_RULE = { window: 60, max: 3 };

/**
 * Setting and removing a password run as server actions, outside the
 * `/api/auth/*` router and therefore outside better-auth's rate limiter — yet
 * each one e-mails the account owner (SE-08). Counted per user, in the same
 * table and with the same semantics as the better-auth counters.
 *
 * @returns false once the user has used up the window.
 */
export async function consumePasswordOperation(userId: string): Promise<boolean> {
  const key = `user:${userId}|/password`;
  const now = Date.now();
  const windowInMs = PASSWORD_OPERATION_RULE.window * 1000;

  return db.transaction(async (tx) => {
    const [counter] = await tx
      .select({ count: authRateLimits.count, lastRequest: authRateLimits.lastRequest })
      .from(authRateLimits)
      .where(eq(authRateLimits.key, key))
      .for("update");

    if (!counter) {
      await tx.insert(authRateLimits).values({ key, count: 1, lastRequest: now });
      return true;
    }

    if (now - counter.lastRequest > windowInMs) {
      await tx
        .update(authRateLimits)
        .set({ count: 1, lastRequest: now })
        .where(eq(authRateLimits.key, key));
      return true;
    }

    if (counter.count >= PASSWORD_OPERATION_RULE.max) return false;

    await tx
      .update(authRateLimits)
      .set({ count: sql`${authRateLimits.count} + 1`, lastRequest: now })
      .where(eq(authRateLimits.key, key));
    return true;
  });
}

import { apiRateLimits, db } from "@louez/db";
import { sql } from "drizzle-orm";

import type { Credential } from "./actor";

/** Calls a connection may make per window, whatever the transport. */
export const API_RATE_LIMIT = { windowMs: 60_000, max: 120 } as const;

/** The rate limit counter of a connection: one per key or grant, shared by every transport. */
export function rateLimitKey(credential: Credential): string {
  return `${credential.kind}:${credential.id ?? credential.userId}`;
}

/**
 * Counts one call for `key` and says whether it fits in the current window.
 * The counter lives in the database, so every app instance shares it.
 *
 * One statement counts and answers: `LAST_INSERT_ID(expr)` hands back the
 * count this very call produced, so concurrent calls each see their own rank.
 * The stored window never moves back: a late call from an older window counts
 * in the newer one instead of resetting it.
 */
export async function consumeRateLimit(
  key: string,
  limit: { windowMs: number; max: number } = API_RATE_LIMIT,
  now = Date.now(),
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const windowStart = now - (now % limit.windowMs);

  // Raw SQL to fix the order of the assignments: MySQL applies them left to
  // right, and `count` must read the old `window_start` before it moves.
  const [header] = await db.execute(sql`
    INSERT INTO ${apiRateLimits} (${sql.identifier("key")}, window_start, count)
    VALUES (${key}, ${windowStart}, 1)
    ON DUPLICATE KEY UPDATE
      count = LAST_INSERT_ID(IF(window_start >= ${windowStart}, count + 1, 1)),
      window_start = GREATEST(window_start, ${windowStart})
  `);

  // A first insert reports no id (the table has no auto-increment): count 1.
  const count = Number((header as unknown as { insertId?: number }).insertId) || 1;
  if (count <= limit.max) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + limit.windowMs - now) / 1000)),
  };
}

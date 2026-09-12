import "server-only";

/**
 * In-memory limiter for the OTP flow (decision 9: kept per process; move
 * to the database before a multi-replica deployment). Limits from audit §5:
 * 3 sends / 15 min and 5 attempts / 15 min, then a 30 min block.
 * The storefront contact form shares it: 5 messages / 15 min per key.
 */

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  blockedUntil?: number;
}

export type RateLimitBucket = "send" | "verify" | "contact";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const MAX_ATTEMPTS: Record<RateLimitBucket, number> = {
  send: 3,
  verify: 5,
  contact: 5,
};

const buckets: Record<RateLimitBucket, Map<string, RateLimitEntry>> = {
  send: new Map(),
  verify: new Map(),
  contact: new Map(),
};

let lastCleanup = Date.now();

const cleanup = (now: number): void => {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS;

  for (const map of Object.values(buckets)) {
    for (const [key, entry] of map) {
      if (entry.firstAttempt < cutoff && (!entry.blockedUntil || entry.blockedUntil < now)) {
        map.delete(key);
      }
    }
  }
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export const buildRateLimitKey = (storeId: string, email: string): string =>
  `${storeId}:${email.trim().toLowerCase()}`;

export const checkRateLimit = (bucket: RateLimitBucket, key: string): RateLimitDecision => {
  const now = Date.now();
  cleanup(now);

  const map = buckets[bucket];
  const entry = map.get(key);

  if (!entry) {
    map.set(key, { attempts: 1, firstAttempt: now });
    return { allowed: true };
  }

  if (entry.blockedUntil && now < entry.blockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  if (now - entry.firstAttempt > WINDOW_MS) {
    map.set(key, { attempts: 1, firstAttempt: now });
    return { allowed: true };
  }

  entry.attempts += 1;

  if (entry.attempts > MAX_ATTEMPTS[bucket]) {
    entry.blockedUntil = now + BLOCK_MS;
    return { allowed: false, retryAfterSeconds: Math.ceil(BLOCK_MS / 1000) };
  }

  return { allowed: true };
};

export const resetRateLimit = (bucket: RateLimitBucket, key: string): void => {
  buckets[bucket].delete(key);
};

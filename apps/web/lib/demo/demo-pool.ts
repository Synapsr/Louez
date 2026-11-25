import "server-only";

import { customAlphabet, nanoid } from "nanoid";

import { createDemoAccountCredential } from "@louez/auth/demo-session";
import {
  claimPooledDemoStore,
  countPooledDemoStores,
  db,
  users,
  type ClaimedDemoStore,
} from "@louez/db";

import { withNamedLock } from "@/lib/billing-sync/locks";
import { log } from "@/lib/evlog";

import {
  DEMO_OWNER_EMAIL_DOMAIN,
  DEMO_OWNER_EMAIL_PREFIX,
  DEMO_POOL_FRESH_MINUTES,
  DEMO_POOL_SIZE,
  DEMO_POOL_TTL_MINUTES,
  DEMO_STORE_TTL_HOURS,
} from "./constants";
import { seedDemoStore } from "./seed-demo-store";
import { DEMO_VERTICAL_KEYS, DEMO_VERTICALS, type DemoVerticalKey } from "./verticals";

/**
 * The pool of demo stores made ahead, a few per trade, so a visitor's click
 * only claims one (a single row update) instead of waiting for a store to be
 * written. A pooled store is a full demo store whose owner account is ready to
 * sign in; no one sees it until it is claimed. Unclaimed, it expires after
 * `DEMO_POOL_TTL_MINUTES` (its « today » would go stale) and the cleanup
 * deletes it like any expired demo store. The pool is topped up after each
 * claim, on the intent to open a demo (/api/demo/warm), and by the cron.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const ownerSuffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 10);

/** A demo owner account, with its credential, and a store of the trade for it. */
export async function createDemoStore(input: {
  vertical: DemoVerticalKey;
  pooled: boolean;
  now?: Date;
}): Promise<ClaimedDemoStore & { email: string }> {
  const now = input.now ?? new Date();
  const vertical = DEMO_VERTICALS[input.vertical];
  const userId = nanoid();
  const email = `${DEMO_OWNER_EMAIL_PREFIX}${ownerSuffix()}@${DEMO_OWNER_EMAIL_DOMAIN}`;
  await db.insert(users).values({
    id: userId,
    email,
    name: vertical.store.ownerName,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await createDemoAccountCredential(userId);
  const store = await seedDemoStore({
    vertical,
    ownerUserId: userId,
    pooled: input.pooled,
    expiresAt: new Date(
      now.getTime() +
        (input.pooled ? DEMO_POOL_TTL_MINUTES * MINUTE_MS : DEMO_STORE_TTL_HOURS * HOUR_MS),
    ),
    now,
    seed: now.getTime() & 0x7fffffff,
  });
  return { id: store.storeId, slug: store.slug, ownerUserId: userId, email };
}

/** Hands a pooled store of the trade to a visitor, for a day, or null when the pool is empty. */
export function claimDemoStore(vertical: DemoVerticalKey, now = new Date()) {
  return claimPooledDemoStore(db, {
    vertical,
    now,
    freshUntil: new Date(
      now.getTime() + (DEMO_POOL_TTL_MINUTES - DEMO_POOL_FRESH_MINUTES) * MINUTE_MS,
    ),
    expiresAt: new Date(now.getTime() + DEMO_STORE_TTL_HOURS * HOUR_MS),
  });
}

/**
 * Tops the trade's pool up to `DEMO_POOL_SIZE` fresh stores. One filler at a
 * time per trade (a MySQL named lock): a second call while one runs does
 * nothing. Never throws.
 */
export async function fillDemoPool(vertical: DemoVerticalKey): Promise<number> {
  try {
    const run = await withNamedLock(`louez:demo-pool:${vertical}`, 0, async () => {
      const now = new Date();
      const fresh = await countPooledDemoStores(db, {
        vertical,
        freshUntil: new Date(
          now.getTime() + (DEMO_POOL_TTL_MINUTES - DEMO_POOL_FRESH_MINUTES) * MINUTE_MS,
        ),
      });
      let made = 0;
      for (let missing = DEMO_POOL_SIZE - fresh; missing > 0; missing--) {
        await createDemoStore({ vertical, pooled: true });
        made += 1;
      }
      return made;
    });
    return run.ran ? run.value : 0;
  } catch (error) {
    log.warn("demo", `pool fill failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/** Tops every trade's pool up, one trade after the other. For the cron. */
export async function fillDemoPools(): Promise<Record<DemoVerticalKey, number>> {
  const made = {} as Record<DemoVerticalKey, number>;
  for (const vertical of DEMO_VERTICAL_KEYS) made[vertical] = await fillDemoPool(vertical);
  return made;
}

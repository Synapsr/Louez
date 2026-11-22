import "server-only";

import { and, count, eq, gt, isNotNull } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";

import { consumeRateLimit } from "@louez/api/platform/rate-limit";
import { signInDemoAccount } from "@louez/auth/demo-session";
import { db, storeMembers, stores, users } from "@louez/db";

import { log } from "@/lib/evlog";
import { getClientIp } from "@/lib/request";

import {
  DEMO_OWNER_EMAIL_DOMAIN,
  DEMO_OWNER_EMAIL_PREFIX,
  DEMO_STARTS_PER_IP_PER_HOUR,
  DEMO_STORE_TTL_HOURS,
  DEMO_STORES_MAX_ACTIVE,
} from "./constants";
import { seedDemoStore } from "./seed-demo-store";
import { DEMO_VERTICALS, type DemoVerticalKey } from "./verticals";

const HOUR_MS = 60 * 60 * 1000;
const ownerSuffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 10);

export type StartDemoResult =
  | {
      ok: true;
      storeId: string;
      slug: string;
      userId: string;
      /** Set-Cookie headers of the visitor's session. */
      sessionHeaders: Headers;
    }
  | { ok: false; error: "rate_limited" | "capacity" | "failed"; retryAfterSeconds?: number };

/**
 * Opens a demo store for one visitor: a throwaway owner account, the trade's
 * store seeded for it (lib/demo/seed-demo-store.ts), and a signed-in session.
 * Both are deleted by the cleanup once `demo_expires_at` passes
 * (lib/demo/cleanup.ts). Each visitor has a store of their own, so nothing one
 * does reaches another.
 */
export async function startDemo(input: {
  vertical: DemoVerticalKey;
  headers: Headers;
  now?: Date;
}): Promise<StartDemoResult> {
  const now = input.now ?? new Date();

  const limit = await consumeRateLimit(
    `demo-start:${getClientIp(input.headers)}`,
    { windowMs: HOUR_MS, max: DEMO_STARTS_PER_IP_PER_HOUR },
    now.getTime(),
  );
  if (!limit.allowed)
    return { ok: false, error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };

  const [active] = await db
    .select({ value: count() })
    .from(stores)
    .where(and(isNotNull(stores.demoVertical), gt(stores.demoExpiresAt, now)));
  if ((active?.value ?? 0) >= DEMO_STORES_MAX_ACTIVE) return { ok: false, error: "capacity" };

  const vertical = DEMO_VERTICALS[input.vertical];
  const userId = nanoid();
  const email = `${DEMO_OWNER_EMAIL_PREFIX}${ownerSuffix()}@${DEMO_OWNER_EMAIL_DOMAIN}`;
  const expiresAt = new Date(now.getTime() + DEMO_STORE_TTL_HOURS * HOUR_MS);

  try {
    await db.insert(users).values({
      id: userId,
      email,
      name: vertical.store.ownerName,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    const store = await seedDemoStore({
      vertical,
      ownerUserId: userId,
      expiresAt,
      now,
      seed: now.getTime() & 0x7fffffff,
    });
    const sessionHeaders = await signInDemoAccount({ userId, email, headers: input.headers });
    return { ok: true, storeId: store.storeId, slug: store.slug, userId, sessionHeaders };
  } catch (error) {
    log.error("demo", `start failed: ${error instanceof Error ? error.message : String(error)}`);
    // A half-made owner without a store is removed by the cleanup too (no store, demo e-mail).
    return { ok: false, error: "failed" };
  }
}

/**
 * The visitor's demo store, when the signed-in user is still its owner and it
 * has not expired: a second click on /demo/<trade> lands back on it.
 */
export async function findLiveDemoStore(input: {
  userId: string;
  storeId: string;
  now?: Date;
}): Promise<{ id: string; slug: string; demoVertical: string } | null> {
  const [row] = await db
    .select({ id: stores.id, slug: stores.slug, demoVertical: stores.demoVertical })
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
  return row?.demoVertical ? { id: row.id, slug: row.slug, demoVertical: row.demoVertical } : null;
}

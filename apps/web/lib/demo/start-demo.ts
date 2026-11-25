import "server-only";

import { and, count, eq, gt, isNotNull } from "drizzle-orm";

import { consumeRateLimit } from "@louez/api/platform/rate-limit";
import { signInDemoAccount } from "@louez/auth/demo-session";
import { db, storeMembers, stores, users } from "@louez/db";

import { log } from "@/lib/evlog";
import { getClientIp } from "@/lib/request";

import {
  DEMO_LIVE_CREATION_WAIT_MS,
  DEMO_LIVE_CREATIONS_AT_ONCE,
  DEMO_STARTS_PER_IP_PER_HOUR,
  DEMO_STORES_MAX_ACTIVE,
} from "./constants";
import { claimDemoStore, createDemoStore } from "./demo-pool";
import type { DemoVerticalKey } from "./verticals";

const HOUR_MS = 60 * 60 * 1000;

export type StartDemoResult =
  | {
      ok: true;
      storeId: string;
      slug: string;
      userId: string;
      /** Set-Cookie headers of the visitor's session. */
      sessionHeaders: Headers;
      /** Taken from the pool, or written for this visitor. */
      source: "pool" | "live";
    }
  | { ok: false; error: "rate_limited" | "capacity" | "failed"; retryAfterSeconds?: number };

// Stores written for visitors right now, in this process, and the visitors
// waiting for a turn: a burst on an empty pool queues instead of filling the
// database's connection pool with long transactions.
let liveCreations = 0;
const waitingForTurn: Array<() => void> = [];

async function takeLiveCreationTurn(): Promise<boolean> {
  if (liveCreations < DEMO_LIVE_CREATIONS_AT_ONCE) {
    liveCreations += 1;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const turn = () => {
      clearTimeout(timer);
      liveCreations += 1;
      resolve(true);
    };
    const timer = setTimeout(() => {
      const index = waitingForTurn.indexOf(turn);
      if (index >= 0) waitingForTurn.splice(index, 1);
      resolve(false);
    }, DEMO_LIVE_CREATION_WAIT_MS);
    waitingForTurn.push(turn);
  });
}

function releaseLiveCreationTurn(): void {
  liveCreations -= 1;
  waitingForTurn.shift()?.();
}

/**
 * Opens a demo store for one visitor and signs them into it: a store claimed
 * from the trade's pool (lib/demo/demo-pool.ts), one row update, or, when the
 * pool is empty, one written for them on the spot (a few tenths of a second;
 * a few at a time, the others queue). Deleted with its owner by the cleanup once
 * `demo_expires_at` passes (lib/demo/cleanup.ts). Each visitor has a store of
 * their own, so nothing one does reaches another.
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
  if (!limit.allowed) {
    return { ok: false, error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  try {
    const claimed = await claimDemoStore(input.vertical, now);
    let store: { id: string; slug: string; ownerUserId: string; email: string };
    let source: "pool" | "live";
    if (claimed) {
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, claimed.ownerUserId))
        .limit(1);
      if (!owner) throw new Error("A pooled demo store has no owner");
      store = { ...claimed, email: owner.email };
      source = "pool";
    } else {
      const [active] = await db
        .select({ value: count() })
        .from(stores)
        .where(and(isNotNull(stores.demoVertical), gt(stores.demoExpiresAt, now)));
      if ((active?.value ?? 0) >= DEMO_STORES_MAX_ACTIVE) return { ok: false, error: "capacity" };
      if (!(await takeLiveCreationTurn()))
        return { ok: false, error: "capacity", retryAfterSeconds: 10 };
      try {
        store = await createDemoStore({ vertical: input.vertical, pooled: false, now });
      } finally {
        releaseLiveCreationTurn();
      }
      source = "live";
    }
    const sessionHeaders = await signInDemoAccount({
      userId: store.ownerUserId,
      email: store.email,
      headers: input.headers,
    });
    return {
      ok: true,
      storeId: store.id,
      slug: store.slug,
      userId: store.ownerUserId,
      sessionHeaders,
      source,
    };
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

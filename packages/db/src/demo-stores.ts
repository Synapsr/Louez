import { eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import type { Database, Transaction } from "./index";
import { stores } from "./schema";

/**
 * Demo stores: a sandbox a prospective renter opens in one click from
 * `/demo/<trade>` (apps/web lib/demo), with a seeded catalog, customers and
 * bookings (`stores.demo_vertical`, migration 0117). A demo store:
 *
 * - sends nothing to anyone: no e-mail, SMS, push, Discord or webhook;
 * - never calls Stripe, a paid AI model, the phone agent or an insurer: its
 *   checkout simulates the payment, as a test reservation does;
 * - stays out of search engines, the marketplace, llms.txt, platform KPIs,
 *   product analytics business metrics and billing;
 * - refuses the actions that reach outside the sandbox (team invitations,
 *   Stripe, billing, integrations: packages/api platform/demo-store-policy.ts);
 * - is deleted, with its owner, once `demo_expires_at` has passed.
 *
 * Every place that treats a demo store apart uses one of the helpers below, so
 * the whole feature is found by searching for `DemoStore` and `demoVertical`.
 */

/** Rows of `stores` that are not demo stores. Combine with `and(...)` on any read of `stores`. */
export function excludeDemoStores(): SQL {
  return sql`${stores.demoVertical} IS NULL`;
}

/** A store id that is not a demo store's: for reads keyed on `<table>.store_id`. */
export function notDemoStoreId(storeIdColumn: AnyColumn): SQL {
  return sql`${storeIdColumn} NOT IN (SELECT ${stores.id} FROM ${stores} WHERE ${stores.demoVertical} IS NOT NULL)`;
}

/** Whether a store row is a demo store. */
export function isDemoStoreRow(
  store: { demoVertical?: string | null } | null | undefined,
): boolean {
  return Boolean(store?.demoVertical);
}

// A store is a demo store from its creation to its deletion: the flag never
// changes, so the answer can be kept. Bounded so a long-running process does not
// grow without limit.
const DEMO_FLAG_CACHE_LIMIT = 5000;
const demoFlagCache = new Map<string, boolean>();

function rememberDemoFlag(storeId: string, isDemo: boolean): void {
  if (demoFlagCache.size >= DEMO_FLAG_CACHE_LIMIT) {
    const oldest = demoFlagCache.keys().next().value;
    if (oldest !== undefined) demoFlagCache.delete(oldest);
  }
  demoFlagCache.set(storeId, isDemo);
}

/**
 * Whether the store is a demo store. False when it does not exist, or when the
 * read fails: a real store's message is never dropped for a passing database
 * error. A demo store holds only undeliverable addresses (`.example`), which
 * `@louez/email` never sends to, so a send it lets through still reaches nobody.
 */
export async function isDemoStore(
  executor: Pick<Database, "select"> | Transaction,
  storeId: string | null | undefined,
): Promise<boolean> {
  if (!storeId) return false;
  const cached = demoFlagCache.get(storeId);
  if (cached !== undefined) return cached;
  try {
    const [row] = await executor
      .select({ demoVertical: stores.demoVertical })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!row) return false;
    const isDemo = isDemoStoreRow(row);
    rememberDemoFlag(storeId, isDemo);
    return isDemo;
  } catch {
    return false;
  }
}

/** For tests: forget what `isDemoStore` remembered. */
export function resetDemoStoreCache(): void {
  demoFlagCache.clear();
}

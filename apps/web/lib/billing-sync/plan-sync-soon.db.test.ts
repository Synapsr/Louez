import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { PlanSyncOptions } from "./plan-sync-soon";

// The early sync of a plan write against a database (louez-billing
// docs/plans/plans-for-new-stores.md decision 8): who bills the store, the store's own
// newest cached version, a stored Retry-After, and a MySQL lock waited for. The relay
// and the heartbeat are fakes; plan-sync-soon.test.ts covers the run itself.

const NEW_STORES_FROM = "2026-06-01T00:00:00Z";
const OLD_STORE = "pss_old";
const NEW_STORE = "pss_new";
/** A new store with no version of its own: the `*` versions apply to it. */
const UNVERSIONED_STORE = "pss_unversioned";

const policy = (storeId: string, version: number, values: Record<string, unknown> = {}) => ({
  schema: "louez.billing.policy/1",
  storeId,
  version,
  effectiveFrom: NEW_STORES_FROM,
  issuedAt: "2026-05-20T10:00:00Z",
  newStoresCreatedFrom: null,
  offerKey: "test-offer",
  invoicing: "service",
  currency: "EUR",
  applicationFee: { kind: "none" },
  marketplaceFeeMinor: 0,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
  ...values,
});

describe("syncPlanSoon (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let locks: typeof import("./locks");
  let policies: typeof import("./policies");
  let state: typeof import("./state");
  let planSync: typeof import("./plan-sync-soon");
  const names = ["LOUEZ_BILLING", "BILLING_SERVICE_URL", "BILLING_NEW_STORES_FROM"] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));

  before(async () => {
    database = await createTestDatabase("plan_sync_soon");
    louezDb = await import("@louez/db");
    locks = await import("./locks");
    policies = await import("./policies");
    state = await import("./state");
    planSync = await import("./plan-sync-soon");
    await louezDb.db.insert(louezDb.stores).values(
      [
        [OLD_STORE, "2026-05-01T00:00:00Z"],
        [NEW_STORE, "2026-07-01T00:00:00Z"],
        [UNVERSIONED_STORE, "2026-07-01T00:00:00Z"],
      ].map(([id = "", createdAt = ""]) => ({
        id,
        userId: `user_${id}`,
        name: id,
        slug: id.replaceAll("_", "-"),
        createdAt: new Date(createdAt),
      })),
    );
    await louezDb.db.insert(louezDb.billingPolicies).values(
      [
        policy("*", 1, { newStoresCreatedFrom: NEW_STORES_FROM }),
        policy(OLD_STORE, 1, { effectiveFrom: "2026-05-01T00:00:00Z", invoicing: "louez_legacy" }),
        policy(NEW_STORE, 1),
        policy(NEW_STORE, 2),
      ].map((body) => ({
        storeId: body.storeId,
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      })),
    );
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM;
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** Caches a version of the store's own, as a policy pull does. */
  async function cache(storeId: string, version: number) {
    const body = policy(storeId, version);
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId,
      version,
      effectiveFrom: new Date(body.effectiveFrom),
      body,
    });
  }

  /**
   * Fakes for the relay, the heartbeat, the lock and the clock; the test of who bills
   * the store, the cache read and the Retry-After are the defaults.
   */
  function fakes(heartbeat: () => Promise<void> = async () => {}) {
    let at = 0;
    const events: string[] = [];
    const info: string[] = [];
    const tasks: Array<() => Promise<void>> = [];
    const options: PlanSyncOptions = {
      schedule: (task) => void tasks.push(task),
      now: () => at,
      sleep: async (ms) => {
        at += ms;
      },
      relay: async () => {
        events.push("relay");
        return { outcome: "ok", detail: null };
      },
      heartbeat: async () => {
        events.push("heartbeat");
        await heartbeat();
        return { outcome: "ok" };
      },
      lock: async (_task, _seconds, run) => ({ ran: true, value: await run() }),
      log: { info: (_tag, message) => void info.push(message), warn: () => {} },
    };
    return {
      events,
      info,
      options,
      async sync(storeId: string, overrides: Partial<PlanSyncOptions> = {}) {
        planSync.syncPlanSoon(storeId, { ...options, ...overrides });
        for (let task = tasks.shift(); task; task = tasks.shift()) await task();
      },
    };
  }

  test("the cache read counts the store's own versions only", async () => {
    assert.equal(await policies.newestCachedStoreVersion(NEW_STORE), 2);
    assert.equal(await policies.newestCachedStoreVersion(UNVERSIONED_STORE), null);
  });

  test("runs for a store the service bills, never for one Louez's legacy code bills", async () => {
    const run = fakes(() => cache(NEW_STORE, 3));
    await run.sync(OLD_STORE);
    assert.deepEqual(run.events, []);

    await run.sync(NEW_STORE);
    assert.deepEqual(run.events, ["relay", "heartbeat"]);
    assert.match(
      run.info[0] ?? "",
      /^plan sync of store pss_new: policy v3 cached, 1 heartbeat\(s\)/,
    );
  });

  test("a newer * version is not the store's answer", async () => {
    const run = fakes(async () => {
      // The first heartbeat caches a * version; the later ones cache nothing.
      if (run.events.filter((event) => event === "heartbeat").length > 1) return;
      const body = policy("*", 2, { newStoresCreatedFrom: NEW_STORES_FROM });
      await louezDb.db.insert(louezDb.billingPolicies).values({
        storeId: "*",
        version: 2,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      });
    });
    await run.sync(UNVERSIONED_STORE);
    assert.deepEqual(run.events, ["relay", "heartbeat", "heartbeat", "heartbeat", "heartbeat"]);
    assert.match(run.info[0] ?? "", /no newer policy version cached yet/);
  });

  test("a Retry-After the service stored holds it", async () => {
    await state.updateSyncState({ retryAfterUntil: new Date(Date.now() + 60_000) });
    try {
      const run = fakes();
      await run.sync(NEW_STORE);
      assert.deepEqual([run.events, run.info], [[], []]);
    } finally {
      await state.updateSyncState({ retryAfterUntil: null });
    }
  });

  test("waits for a MySQL lock another connection holds, then runs under it", async () => {
    // Lock names of the test's own: the billing locks belong to the whole MySQL server.
    const prefix = `louez:test:plan-sync:${randomBytes(4).toString("hex")}`;
    const mysql = await import("mysql2/promise");
    const holder = await mysql.createConnection({ uri: process.env.DATABASE_URL ?? "" });
    try {
      await holder.query("SELECT GET_LOCK(?, 0)", [`${prefix}:relay`]);
      const timeouts: number[] = [];
      let relayedAt = 0;
      const run = fakes(() => cache(NEW_STORE, 10));
      const going = run.sync(NEW_STORE, {
        lock: (task, seconds, work) => {
          timeouts.push(seconds);
          return locks.withNamedLock(`${prefix}:${task}`, seconds, work);
        },
        relay: async () => {
          relayedAt = Date.now();
          return { outcome: "ok", detail: null };
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.equal(relayedAt, 0, "the relay waits while the lock is held");
      const releasedAt = Date.now();
      await holder.query("SELECT RELEASE_LOCK(?)", [`${prefix}:relay`]);
      await going;
      assert.ok(relayedAt >= releasedAt, "the relay runs once the lock is free");
      assert.deepEqual(timeouts, [25, 25]);
      assert.match(run.info[0] ?? "", /policy v10 cached, 1 heartbeat\(s\)/);
    } finally {
      await holder.end();
    }
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// Demo stores (demo-stores.ts) are never billed: in service mode, with a policy that
// refuses every new reservation, a demo store's gate stays open, its confirmed booking
// gets no billing date, and nothing of it reaches the billing queue.

const ENV_NAMES = ["LOUEZ_BILLING", "BILLING_SERVICE_URL", "BILLING_NEW_STORES_FROM"] as const;
const DEMO = "demo_store";
const REAL = "real_store";

const blockingPolicy = {
  schema: "louez.billing.policy/1",
  storeId: "*",
  version: 1,
  effectiveFrom: "2026-01-01T00:00:00Z",
  issuedAt: "2026-01-01T00:00:00Z",
  newStoresCreatedFrom: "2026-01-01T00:00:00Z",
  offerKey: "test",
  invoicing: "service",
  currency: "EUR",
  applicationFee: { kind: "none" },
  marketplaceFeeMinor: 0,
  reservations: { allowed: false, reason: "payment_method_required" },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Test", en: "Test" }, notice: null },
};

describe("demo stores (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("./index");
  const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

  before(async () => {
    database = await createTestDatabase("demo_stores");
    louezDb = await import("./index");
    const createdAt = new Date("2026-06-01T00:00:00Z");
    await louezDb.db.insert(louezDb.stores).values([
      {
        id: DEMO,
        userId: "owner_demo",
        name: "Démo",
        slug: "demo-store",
        demoVertical: "ski",
        demoExpiresAt: new Date(Date.now() + 86_400_000),
        createdAt,
      },
      { id: REAL, userId: "owner_real", name: "Réelle", slug: "real-store", createdAt },
    ]);
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: "*",
      version: 1,
      effectiveFrom: new Date(blockingPolicy.effectiveFrom),
      body: blockingPolicy,
    });
  });

  after(async () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = "2026-01-01T00:00:00Z";
    louezDb.resetDemoStoreCache();
  });

  test("isDemoStore and excludeDemoStores tell demo stores apart", async () => {
    assert.equal(await louezDb.isDemoStore(louezDb.db, DEMO), true);
    assert.equal(await louezDb.isDemoStore(louezDb.db, REAL), false);
    assert.equal(await louezDb.isDemoStore(louezDb.db, "missing"), false);
    const rows = await louezDb.db
      .select({ id: louezDb.stores.id })
      .from(louezDb.stores)
      .where(louezDb.excludeDemoStores());
    assert.deepEqual(
      rows.map((row) => row.id),
      [REAL],
    );
  });

  test("a demo store's gate stays open under a policy that refuses everyone", async () => {
    const real = await louezDb.readReservationGate(louezDb.db, REAL);
    assert.equal(real.accepts, false);
    const demo = await louezDb.readReservationGate(louezDb.db, DEMO);
    assert.equal(demo.accepts, true);
  });

  test("a demo store's confirmed booking has no billing date and no billing mark", async () => {
    const { effects } = await louezDb.db.transaction((tx) =>
      louezDb.insertReservation(tx, {
        id: "demo_res_1",
        storeId: DEMO,
        customerId: "customer",
        number: "R1",
        status: "confirmed",
        source: "online",
        startDate: new Date("2027-01-01T09:00:00Z"),
        endDate: new Date("2027-01-03T09:00:00Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
      }),
    );
    assert.deepEqual(effects, []);
    const [row] = await louezDb.db
      .select({ billableAt: louezDb.reservations.billableAt })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, "demo_res_1"));
    assert.equal(row?.billableAt, null);
    const [queued] = (await louezDb.db.execute(
      sql`SELECT COUNT(*) AS n FROM billing_sync_queue WHERE store_id = ${DEMO}`,
    )) as unknown as [Array<{ n: number }>];
    assert.equal(Number(queued[0]?.n), 0);
  });

  test("markBillingDirty drops a demo store's marks and keeps the others", async () => {
    await louezDb.markBillingDirty(louezDb.db, [
      { type: "store", aggregateId: DEMO, storeId: DEMO },
      { type: "store", aggregateId: REAL, storeId: REAL },
    ]);
    const [rows] = (await louezDb.db.execute(
      sql`SELECT store_id AS storeId FROM billing_sync_queue WHERE aggregate_type = 'store' ORDER BY store_id`,
    )) as unknown as [Array<{ storeId: string }>];
    assert.deepEqual(
      rows.map((row) => row.storeId),
      [REAL],
    );
  });
});

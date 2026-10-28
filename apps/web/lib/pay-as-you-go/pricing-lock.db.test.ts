import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// Every write to a subscription row marks the store's legacy_store snapshot for the
// billing service in the same transaction (louez-billing docs/api, README §5.2):
// the Drizzle helpers, the raw pricing freeze and the Stripe subscription writes.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

describe("legacy_store marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let lock: typeof import("./pricing-lock");
  let core: typeof import("./pricing-lock-core");
  let stripeSubscriptions: typeof import("@/lib/stripe/subscriptions");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("legacy_store_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    lock = await import("./pricing-lock");
    core = await import("./pricing-lock-core");
    stripeSubscriptions = await import("@/lib/stripe/subscriptions");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.billingSyncQueue);
  });

  async function addStore(): Promise<string> {
    const id = `store_lsm_${++counter}`;
    await louezDb.db.insert(louezDb.stores).values({
      id,
      userId: "owner",
      name: id,
      slug: id.replace(/_/g, "-"),
      settings: {
        reservationMode: "payment",
        minRentalMinutes: 60,
        maxRentalMinutes: null,
        advanceNoticeMinutes: 0,
        turnoverBufferMinutes: 0,
        currency: "EUR",
      },
    });
    return id;
  }

  async function addRow(storeId: string, free = 5): Promise<string> {
    const id = `sub_${storeId}`.slice(0, 21);
    await louezDb.db.insert(louezDb.subscriptions).values({
      id,
      storeId,
      billingMode: "pay_as_you_go",
      // Spelled out, so the freeze leaves it alone.
      payAsYouGoConfig: core.buildFrozenPayAsYouGoConfig({ flatRateCents: 123 }, "EUR"),
      pricingVersion: "payg-ladder-v1",
      freeReservationsGranted: free,
    });
    return id;
  }

  async function legacyMarks() {
    const { billingSyncQueue: queueTable } = louezDb;
    return louezDb.db
      .select({ storeId: queueTable.aggregateId, version: queueTable.version })
      .from(queueTable)
      .where(eq(queueTable.aggregateType, "legacy_store"))
      .orderBy(queueTable.aggregateId);
  }

  async function freeGranted(storeId: string) {
    const row = await louezDb.db.query.subscriptions.findFirst({
      where: (table) => eq(table.storeId, storeId),
      columns: { freeReservationsGranted: true },
    });
    return row?.freeReservationsGranted;
  }

  test("raising the free reservations marks legacy_store once, row created or not", async () => {
    const withRow = await addStore();
    const withoutRow = await addStore();
    await addRow(withRow, 5);

    await lock.raiseFreeReservations(louezDb.db, withRow, 30);
    await lock.raiseFreeReservations(louezDb.db, withoutRow, 30);

    assert.equal(await freeGranted(withRow), 30);
    assert.equal(await freeGranted(withoutRow), 30);
    assert.deepEqual(await legacyMarks(), [
      { storeId: withRow, version: 1 },
      { storeId: withoutRow, version: 1 },
    ]);
  });

  test("ensureSubscriptionRow marks only the store whose row it creates", async () => {
    const withRow = await addStore();
    const withoutRow = await addStore();
    await addRow(withRow);

    await lock.ensureSubscriptionRow(louezDb.db, withRow);
    await lock.ensureSubscriptionRow(louezDb.db, withoutRow);

    assert.deepEqual(await legacyMarks(), [{ storeId: withoutRow, version: 1 }]);
  });

  test("the allowance and its mark roll back with the caller's transaction", async () => {
    const storeId = await addStore();
    await addRow(storeId, 5);

    await assert.rejects(
      louezDb.db.transaction(async (tx) => {
        await lock.addFreeReservations(tx, storeId, 10);
        throw new Error("rollback");
      }),
      /rollback/,
    );

    assert.equal(await freeGranted(storeId), 5);
    assert.deepEqual(await legacyMarks(), []);
  });

  test("the pricing freeze marks each store whose row it changed, on its connection", async () => {
    const unfrozen = await addStore();
    const missing = await addStore();
    const frozen = await addStore();
    await louezDb.db.insert(louezDb.subscriptions).values({
      id: `sub_${unfrozen}`.slice(0, 21),
      storeId: unfrozen,
      billingMode: "pay_as_you_go",
      freeReservationsGranted: 3,
    });
    await addRow(frozen);

    const connection = await database.connect();
    try {
      const plan = await lock.planLegacyPricingFreeze(connection);
      const result = await lock.applyLegacyPricingFreeze(connection, plan, {
        offer: { flatRateCents: 40 },
        freeReservations: 12,
      });
      assert.ok(result.frozen >= 1 && result.created >= 1);
    } finally {
      await connection.end();
    }

    const marked = (await legacyMarks()).map((mark) => mark.storeId);
    assert.ok(marked.includes(unfrozen), "the frozen row");
    assert.ok(marked.includes(missing), "the created row");
    assert.ok(!marked.includes(frozen), "a row the freeze left alone");
  });

  test("the Stripe subscription writes mark legacy_store", async () => {
    const storeId = await addStore();

    await stripeSubscriptions.activatePlanSubscription({
      storeId,
      planSlug: "pro",
      stripeSubscriptionId: `sub_stripe_${storeId}`,
      stripeCustomerId: `cus_${storeId}`,
      status: "active",
      currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
    });
    const row = await louezDb.db.query.subscriptions.findFirst({
      where: (table) => eq(table.storeId, storeId),
      columns: { id: true, billingMode: true },
    });
    assert.equal(row?.billingMode, "subscription");
    // The row's creation and the update each bump the version; gaps are fine (§5.2).
    const [created] = await legacyMarks();
    assert.equal(created?.storeId, storeId);

    await stripeSubscriptions.endSubscriptionToPayAsYouGo(row?.id ?? "");

    assert.deepEqual(await legacyMarks(), [{ storeId, version: (created?.version ?? 0) + 1 }]);
  });
});

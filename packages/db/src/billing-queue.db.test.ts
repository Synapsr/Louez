import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { sql } from "drizzle-orm";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// The billing marks on a migrated database (louez-billing docs/api, README §5.2).

describe("billing queue marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("./index");
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("billing_queue");
    louezDb = await import("./index");
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
    await louezDb.db.execute(sql`DELETE FROM billing_sync_queue`);
  });
  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const rows = async () => {
    const [result] = (await louezDb.db.execute(
      sql`SELECT aggregate_type AS type, aggregate_id AS id, version, status, sent_hash AS sentHash
          FROM billing_sync_queue ORDER BY aggregate_type, aggregate_id`,
    )) as unknown as [
      Array<{ type: string; id: string; version: number; status: string; sentHash: string | null }>,
    ];
    return result;
  };

  test("a mark creates the row at version 1, and each later mark bumps it", async () => {
    await louezDb.markStore(louezDb.db, "s1");
    await louezDb.markStore(louezDb.db, "s1");
    await louezDb.markBillingDirty(louezDb.db, [
      { type: "store", aggregateId: "s1", storeId: "s1" },
      { type: "store", aggregateId: "s1", storeId: "s1" },
    ]);
    assert.deepEqual(await rows(), [
      { type: "store", id: "s1", version: 3, status: "pending", sentHash: null },
    ]);
  });

  test("a subscription row write marks the store and its legacy snapshot", async () => {
    await louezDb.markSubscriptionRow(louezDb.db, "s1");
    assert.deepEqual(await rows(), [
      { type: "store", id: "s1", version: 1, status: "pending", sentHash: null },
      { type: "legacy_store", id: "s1", version: 1, status: "pending", sentHash: null },
    ]);
  });

  test("a mark rolls back with its transaction", async () => {
    await assert.rejects(
      louezDb.db.transaction(async (tx) => {
        await louezDb.markLegacyMonth(tx, "s1", "2026-10");
        throw new Error("rollback");
      }),
    );
    assert.deepEqual(await rows(), []);
  });

  test("a plain mark keeps a dead row dead; a forced mark revives it and clears the hash", async () => {
    await louezDb.markReservation(louezDb.db, { id: "r1", storeId: "s1" });
    await louezDb.db.execute(sql`UPDATE billing_sync_queue SET status = 'dead', sent_hash = 'abc'`);
    await louezDb.markReservation(louezDb.db, { id: "r1", storeId: "s1" });
    assert.deepEqual((await rows())[0], {
      type: "reservation",
      id: "r1",
      version: 2,
      status: "dead",
      sentHash: "abc",
    });
    await louezDb.markReservation(louezDb.db, { id: "r1", storeId: "s1" }, { force: true });
    assert.deepEqual((await rows())[0], {
      type: "reservation",
      id: "r1",
      version: 3,
      status: "pending",
      sentHash: null,
    });
  });

  test("reservations marked by id get their store from the reservation row", async () => {
    await louezDb.db.insert(louezDb.reservations).values({
      id: "res_known",
      storeId: "s9",
      customerId: "c",
      number: "R-1",
      status: "confirmed",
      startDate: new Date("2026-11-01T09:00:00Z"),
      endDate: new Date("2026-11-02T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.markReservationIds(louezDb.db, ["res_known", "res_unknown"]);
    const [row] = (await louezDb.db.execute(
      sql`SELECT store_id AS storeId FROM billing_sync_queue WHERE aggregate_id = 'res_known'`,
    )) as unknown as [Array<{ storeId: string }>];
    assert.deepEqual(row, [{ storeId: "s9" }]);
    assert.equal((await rows()).length, 1);
  });

  test("a store's reservations are all marked, and only for that store", async () => {
    const reservation = (id: string, storeId: string) => ({
      id,
      storeId,
      customerId: "c",
      number: id,
      status: "completed" as const,
      startDate: new Date("2026-06-01T09:00:00Z"),
      endDate: new Date("2026-06-02T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    const item = (reservationId: string, index: number, taxRate: string | null) => ({
      id: `item_${reservationId}_${index}`,
      reservationId,
      quantity: 1,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "10.00",
      taxRate,
      productSnapshot: { name: "Kayak", description: null, images: [] },
    });
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("res_mixed", "s_tax"),
        reservation("res_taxed", "s_tax"),
        reservation("res_no_items", "s_tax"),
        reservation("res_other", "s_other"),
      ]);
    await louezDb.db
      .insert(louezDb.reservationItems)
      .values([
        item("res_mixed", 1, "20.00"),
        item("res_mixed", 2, null),
        item("res_taxed", 1, "20.00"),
        item("res_other", 1, null),
      ]);
    await louezDb.markStoreReservations(louezDb.db, "s_tax");
    await louezDb.db.transaction(async (tx) => {
      await louezDb.markStoreReservations(tx, "s_tax");
      // The mark read the rows without a lock: another connection takes them at once.
      await louezDb.db.execute(
        sql`SELECT r.id FROM reservations r JOIN reservation_items i ON i.reservation_id = r.id
            WHERE r.id = 'res_mixed' FOR UPDATE NOWAIT`,
      );
    });
    assert.deepEqual(await rows(), [
      { type: "reservation", id: "res_mixed", version: 2, status: "pending", sentHash: null },
      { type: "reservation", id: "res_no_items", version: 2, status: "pending", sentHash: null },
      { type: "reservation", id: "res_taxed", version: 2, status: "pending", sentHash: null },
    ]);

    process.env.LOUEZ_BILLING = "off";
    await louezDb.markStoreReservations(louezDb.db, "s_other");
    assert.equal((await rows()).length, 3);
  });

  test("marking reservations by id leaves the reservation rows unlocked", async () => {
    await louezDb.db.insert(louezDb.reservations).values({
      id: "res_unlocked",
      storeId: "s8",
      customerId: "c",
      number: "R-unlocked",
      status: "confirmed",
      startDate: new Date("2026-11-01T09:00:00Z"),
      endDate: new Date("2026-11-02T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.db.transaction(async (tx) => {
      await louezDb.markReservationIds(tx, ["res_unlocked"]);
      // Another connection locks the reservation at once. A mark that read it with
      // a lock would hold it until this transaction ends, and a payment-first
      // transaction would then deadlock with one that updates the reservation.
      await louezDb.db.execute(
        sql`SELECT id FROM reservations WHERE id = 'res_unlocked' FOR UPDATE NOWAIT`,
      );
    });
    assert.deepEqual(await rows(), [
      { type: "reservation", id: "res_unlocked", version: 1, status: "pending", sentHash: null },
    ]);
  });

  test("marks write nothing when Louez does not bill through the service", async () => {
    delete process.env.BILLING_SERVICE_URL;
    await louezDb.markStore(louezDb.db, "s1");
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
    process.env.LOUEZ_BILLING = "off";
    await louezDb.markStore(louezDb.db, "s1");
    assert.deepEqual(await rows(), []);
  });
});

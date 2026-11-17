import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

// The deletion of a test reservation on a migrated database: every row that
// hangs from it goes, its test customer too once nothing else is left of it,
// its files and its analytics event go to the outbox; a real reservation is
// refused and never touched; the daily cleanup takes only the expired ones.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const DAY = 86_400_000;

describe("test reservations (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let service: typeof import("./test-reservations");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("test_reservations");
    louezDb = await import("@louez/db");
    service = await import("./test-reservations");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function store() {
    const id = nextId("store");
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id, userId: nextId("user"), name: "Shop", slug: id });
    return id;
  }

  async function customer(storeId: string, isTest: boolean) {
    const id = nextId("cus");
    await louezDb.db.insert(louezDb.customers).values({
      id,
      storeId,
      email: `${id}@example.com`,
      firstName: "Ada",
      lastName: "Lovelace",
      isTest,
    });
    return id;
  }

  /** A reservation with one line, a payment, an activity row, an inspection with a photo. */
  async function reservation(
    storeId: string,
    customerId: string,
    options: { isTest: boolean; createdAt?: Date },
  ) {
    const id = nextId("res");
    const itemId = nextId("itm");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId,
      number: id,
      status: "confirmed",
      startDate: new Date("2031-05-10T09:00:00.000Z"),
      endDate: new Date("2031-05-12T09:00:00.000Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      isTest: options.isTest,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId: id,
      productId: nextId("prd"),
      quantity: 1,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "10.00",
      productSnapshot: { name: "Bike", description: null, images: [] },
    });
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("pay"),
      reservationId: id,
      amount: "10.00",
      type: "rental",
      method: "cash",
      status: "completed",
    });
    await louezDb.db
      .insert(louezDb.reservationActivity)
      .values({ id: nextId("act"), reservationId: id, activityType: "created" });
    const inspectionId = nextId("ins");
    const inspectionItemId = nextId("iit");
    await louezDb.db
      .insert(louezDb.inspections)
      .values({ id: inspectionId, storeId, reservationId: id, type: "departure" });
    await louezDb.db.insert(louezDb.inspectionItems).values({
      id: inspectionItemId,
      inspectionId,
      reservationItemId: itemId,
      productSnapshot: { name: "Bike" },
    });
    await louezDb.db.insert(louezDb.inspectionPhotos).values({
      id: nextId("pho"),
      inspectionItemId,
      photoKey: `${storeId}/inspections/${id}.jpg`,
      photoUrl: "https://example.com/photo.jpg",
      thumbnailKey: `${storeId}/inspections/${id}-thumb.jpg`,
    });
    return { id, itemId, inspectionId };
  }

  const count = async (
    table: "reservations" | "reservationItems" | "payments" | "inspections",
    id: string,
  ) => {
    const column = {
      reservations: louezDb.reservations.id,
      reservationItems: louezDb.reservationItems.reservationId,
      payments: louezDb.payments.reservationId,
      inspections: louezDb.inspections.reservationId,
    }[table];
    const rows = await louezDb.db.select({ id: column }).from(louezDb[table]).where(eq(column, id));
    return rows.length;
  };

  test("deletes the test reservation with every row and its test customer, and queues its files", async () => {
    const storeId = await store();
    const testCustomer = await customer(storeId, true);
    await louezDb.db.insert(louezDb.customerSessions).values({
      id: nextId("ses"),
      customerId: testCustomer,
      token: nextId("token"),
      expiresAt: new Date(Date.now() + DAY),
    });
    const testRow = await reservation(storeId, testCustomer, { isTest: true });
    const realRow = await reservation(storeId, await customer(storeId, false), { isTest: false });

    const result = await service.deleteTestReservation({
      storeId,
      reservationId: testRow.id,
      analytics: { distinctId: "user", trigger: "manual" },
    });

    assert.equal(result.deleted, true);
    for (const table of ["reservations", "reservationItems", "payments", "inspections"] as const) {
      assert.equal(await count(table, testRow.id), 0, table);
      assert.equal(await count(table, realRow.id), 1, table);
    }
    const [gone] = await louezDb.db
      .select({ id: louezDb.customers.id })
      .from(louezDb.customers)
      .where(eq(louezDb.customers.id, testCustomer));
    assert.equal(gone, undefined);
    const sessions = await louezDb.db
      .select({ id: louezDb.customerSessions.id })
      .from(louezDb.customerSessions)
      .where(eq(louezDb.customerSessions.customerId, testCustomer));
    assert.equal(sessions.length, 0);

    const effects = await louezDb.db
      .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
      .from(louezDb.apiEffects)
      .where(eq(louezDb.apiEffects.storeId, storeId));
    assert.deepEqual(effects.map((effect) => effect.type).sort(), [
      "testReservation.analytics",
      "testReservation.deleteFiles",
    ]);
    const files = effects.find((effect) => effect.type === "testReservation.deleteFiles");
    assert.deepEqual(files?.payload, {
      keys: [
        `${storeId}/inspections/${testRow.id}.jpg`,
        `${storeId}/inspections/${testRow.id}-thumb.jpg`,
      ],
    });
  });

  test("refuses a real reservation as not found and leaves it whole", async () => {
    const storeId = await store();
    const real = await reservation(storeId, await customer(storeId, false), { isTest: false });
    await assert.rejects(
      service.deleteTestReservation({
        storeId,
        reservationId: real.id,
        analytics: { distinctId: "user", trigger: "manual" },
      }),
      (error: { data?: { code?: string } }) => error.data?.code === "RESERVATION_NOT_FOUND",
    );
    assert.equal(await count("reservations", real.id), 1);
    assert.equal(await count("payments", real.id), 1);
  });

  test("keeps a test customer another reservation still names", async () => {
    const storeId = await store();
    const testCustomer = await customer(storeId, true);
    const testRow = await reservation(storeId, testCustomer, { isTest: true });
    // A real checkout with the same customer, made before it turned real.
    await reservation(storeId, testCustomer, { isTest: false });

    await service.deleteTestReservation({
      storeId,
      reservationId: testRow.id,
      analytics: { distinctId: "user", trigger: "manual" },
    });
    const [kept] = await louezDb.db
      .select({ id: louezDb.customers.id })
      .from(louezDb.customers)
      .where(eq(louezDb.customers.id, testCustomer));
    assert.ok(kept);
  });

  test("a real checkout holding the test customer makes the purge keep it", async () => {
    const storeId = await store();
    const testCustomer = await customer(storeId, true);
    const testRow = await reservation(storeId, testCustomer, { isTest: true });
    const realId = nextId("res");

    // The checkout (upsertCustomer): the customer locked by id, made real, then
    // a real reservation inserted for it, not committed yet.
    const checkout = await database.connect();
    try {
      await checkout.beginTransaction();
      await checkout.query(
        "SELECT id FROM customers FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE",
        [testCustomer],
      );
      await checkout.query("UPDATE customers SET is_test = 0 WHERE id = ?", [testCustomer]);
      await checkout.query(
        `INSERT INTO reservations
           (id, store_id, customer_id, number, start_date, end_date,
            subtotal_amount, deposit_amount, total_amount)
         VALUES (?, ?, ?, ?, '2031-06-01 09:00:00', '2031-06-02 09:00:00', '10.00', '0.00', '10.00')`,
        [realId, storeId, testCustomer, realId],
      );

      const purge = service.deleteTestReservation({
        storeId,
        reservationId: testRow.id,
        analytics: { distinctId: "user", trigger: "manual" },
      });
      await waitForLockWaits(checkout, database.name, 1);
      await checkout.commit();
      assert.equal((await purge).deleted, true);
    } finally {
      await checkout.end();
    }

    assert.equal(await count("reservations", testRow.id), 0);
    assert.equal(await count("reservations", realId), 1);
    const [kept] = await louezDb.db
      .select({ id: louezDb.customers.id, isTest: louezDb.customers.isTest })
      .from(louezDb.customers)
      .where(eq(louezDb.customers.id, testCustomer));
    assert.deepEqual(
      kept,
      { id: testCustomer, isTest: false },
      "the customer the checkout made real",
    );
  });

  test("the daily cleanup takes only the test reservations past their lifetime", async () => {
    const now = new Date();
    const oldStore = await store();
    const freshStore = await store();
    const old = await reservation(oldStore, await customer(oldStore, true), {
      isTest: true,
      createdAt: new Date(now.getTime() - 8 * DAY),
    });
    const fresh = await reservation(freshStore, await customer(freshStore, true), {
      isTest: true,
      createdAt: new Date(now.getTime() - DAY),
    });

    const result = await service.purgeExpiredTestReservations({ now });
    assert.equal(result.failed, 0);
    assert.equal(await count("reservations", old.id), 0);
    assert.equal(await count("reservations", fresh.id), 1);
  });
});

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";

// The nightly sweep on a migrated database (louez-billing docs/api, README §7.4).

describe("billing sweep (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let service: FakeBillingService;
  let restoreEnv: () => void;
  let louezDb: typeof import("@louez/db");
  let sweep: typeof import("./sweep");
  const now = new Date("2026-10-25T02:00:30Z");

  before(async () => {
    database = await createTestDatabase("billing_sweep");
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
    louezDb = await import("@louez/db");
    sweep = await import("./sweep");

    const { db, stores, reservations, payments } = louezDb;
    await db.insert(stores).values([
      {
        id: "sw_legacy",
        userId: "u1",
        name: "Legacy",
        slug: "sw-legacy",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "sw_new",
        userId: "u2",
        name: "New",
        slug: "sw-new",
        createdAt: new Date("2027-02-01T00:00:00Z"),
      },
    ]);
    const reservation = (id: string, status: "pending" | "completed", endDate: string) => ({
      id,
      storeId: "sw_legacy",
      customerId: "customer",
      number: id,
      status,
      startDate: new Date("2026-01-01T08:00:00Z"),
      endDate: new Date(endDate),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      createdAt: new Date("2026-01-01T08:00:00Z"),
      updatedAt: new Date("2026-01-01T08:00:00Z"),
    });
    // Fixtures written directly: the sweep only reads them.
    await db
      .insert(reservations)
      .values([
        reservation("sw_open", "pending", "2026-01-02T08:00:00Z"),
        reservation("sw_ended_recently", "completed", "2026-10-15T08:00:00Z"),
        reservation("sw_paid_recently", "completed", "2026-02-02T08:00:00Z"),
        reservation("sw_old", "completed", "2026-02-02T08:00:00Z"),
      ]);
    await db.insert(payments).values({
      id: "sw_pay",
      reservationId: "sw_paid_recently",
      amount: "10.00",
      type: "rental",
      method: "cash",
      status: "completed",
      paidAt: new Date("2026-02-01T08:00:00Z"),
      createdAt: new Date("2026-02-01T08:00:00Z"),
      updatedAt: new Date("2026-10-20T08:00:00Z"),
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await service?.close();
    restoreEnv?.();
    await database?.drop();
  });

  test("plain-marks what may have changed, then records when every mark was committed", async () => {
    const result = await sweep.runSweep(now);
    assert.equal(result.due, true);
    const [rows] = await louezDb.db.execute(
      sql`SELECT CAST(aggregate_type AS CHAR) AS type, aggregate_id AS id FROM billing_sync_queue
          ORDER BY CAST(aggregate_type AS CHAR), aggregate_id`,
    );
    assert.deepEqual(z.array(z.object({ type: z.string(), id: z.string() })).parse(rows), [
      { type: "legacy_month", id: "sw_legacy:2026-09" },
      { type: "legacy_month", id: "sw_legacy:2026-10" },
      { type: "legacy_store", id: "sw_legacy" },
      { type: "reservation", id: "sw_ended_recently" },
      { type: "reservation", id: "sw_open" },
      { type: "reservation", id: "sw_paid_recently" },
      { type: "store", id: "sw_legacy" },
      { type: "store", id: "sw_new" },
    ]);
    const [state] = await louezDb.db.select().from(louezDb.billingSyncState);
    assert.ok(state?.lastSweepAt, "lastSweepAt is set");
    // The same night, the sweep does not run again.
    assert.deepEqual(await sweep.runSweep(new Date("2026-10-25T02:10:00Z")), { due: false });
  });
});

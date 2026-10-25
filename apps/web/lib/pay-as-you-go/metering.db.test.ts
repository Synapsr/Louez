import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The billing marks of the legacy fee ledger on a migrated database: a platform_fee or
// pay_as_you_go_invoices write marks its store's month, and a free row the store's
// free credits too, in the write's transaction.

const FREE_STORE = "store_marks_free";
const PAID_STORE = "store_marks_paid";
const JANUARY = new Date("2026-01-15T10:00:00Z");

describe("legacy fee marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let metering: typeof import("./metering");
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("legacy_fee_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    metering = await import("./metering");

    const payAsYouGo = {
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1",
    } as const;
    await louezDb.db.insert(louezDb.subscriptions).values([
      { id: "sub_marks_free", storeId: FREE_STORE, ...payAsYouGo, freeReservationsGranted: 1 },
      { id: "sub_marks_paid", storeId: PAID_STORE, ...payAsYouGo, freeReservationsGranted: 0 },
    ]);
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
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

  async function readMarks(storeId: string) {
    const queue = louezDb.billingSyncQueue;
    const rows = await louezDb.db
      .select({ type: queue.aggregateType, id: queue.aggregateId, version: queue.version })
      .from(queue)
      .where(eq(queue.storeId, storeId))
      .orderBy(asc(queue.aggregateType), asc(queue.aggregateId));
    return rows.map((row) => `${row.type} ${row.id} v${row.version}`);
  }

  test("a free row marks the month and the free credits; a paid row only the month", async () => {
    await metering.recordReservationFee({
      storeId: FREE_STORE,
      reservationId: "res_marks_free",
      source: "manual",
      at: JANUARY,
    });
    assert.deepEqual(await readMarks(FREE_STORE), [
      `legacy_store ${FREE_STORE} v1`,
      `legacy_month ${FREE_STORE}:2026-01 v1`,
    ]);

    // The credit is spent: this one is a pending manual fee.
    await metering.recordReservationFee({
      storeId: FREE_STORE,
      reservationId: "res_marks_paid",
      source: "manual",
      at: JANUARY,
    });
    assert.deepEqual(await readMarks(FREE_STORE), [
      `legacy_store ${FREE_STORE} v1`,
      `legacy_month ${FREE_STORE}:2026-01 v2`,
    ]);

    // Voiding the pending fee changes the month; voiding the free one returns the credit.
    assert.deepEqual(await metering.voidReservationFee("res_marks_paid"), { voided: true });
    assert.deepEqual(await metering.voidReservationFee("res_marks_free"), { voided: true });
    assert.deepEqual(await readMarks(FREE_STORE), [
      `legacy_store ${FREE_STORE} v2`,
      `legacy_month ${FREE_STORE}:2026-01 v4`,
    ]);

    // Nothing left to void: no write, no mark.
    assert.deepEqual(await metering.voidReservationFee("res_marks_free"), { voided: false });
    assert.equal((await readMarks(FREE_STORE)).length, 2);
  });

  test("a fee reversal and the month-end run mark the month", async () => {
    await metering.recordReservationFee({
      storeId: PAID_STORE,
      reservationId: "res_marks_online",
      source: "online",
      collectedAmountCents: 150,
      stripePaymentIntentId: "pi_marks_online",
      at: JANUARY,
    });
    assert.deepEqual(await readMarks(PAID_STORE), [`legacy_month ${PAID_STORE}:2026-01 v1`]);

    const { rows } = await metering.getReversibleFees("pi_marks_online");
    await metering.recordFeeReversals(metering.distributeReversal(rows, 50));
    assert.deepEqual(await readMarks(PAID_STORE), [`legacy_month ${PAID_STORE}:2026-01 v2`]);

    // Everything was collected at source: the run claims the month and voids it, with no
    // Stripe call. The claim and the void each mark it.
    const billing = await import("./billing");
    const outcome = await billing.billStoreForMonth(PAID_STORE, "2026-01");
    assert.equal(outcome.status, "void");
    assert.deepEqual(await readMarks(PAID_STORE), [`legacy_month ${PAID_STORE}:2026-01 v4`]);
  });

  test("without the billing service, the ledger is written and nothing is marked", async () => {
    delete process.env.BILLING_SERVICE_URL;
    const storeId = "store_marks_off";
    await louezDb.db.insert(louezDb.subscriptions).values({
      id: "sub_marks_off",
      storeId,
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1",
    });
    const result = await metering.recordReservationFee({
      storeId,
      reservationId: "res_marks_off",
      source: "manual",
      at: JANUARY,
    });
    assert.equal(result.recorded, true);
    assert.deepEqual(await readMarks(storeId), []);
  });
});

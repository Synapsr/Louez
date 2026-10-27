import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The billing marks of the legacy fee ledger on a migrated database: a platform_fee or
// pay_as_you_go_invoices write marks its store's month, a platform_fee write its
// reservation, and a free row the store's free credits too, in the write's transaction.

const FREE_STORE = "store_marks_free";
const PAID_STORE = "store_marks_paid";
const UPGRADE_STORE = "store_marks_upgrade";
const RACE_STORE = "store_marks_race";
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
      {
        id: "sub_marks_upgrade",
        storeId: UPGRADE_STORE,
        ...payAsYouGo,
        freeReservationsGranted: 0,
      },
      { id: "sub_marks_race", storeId: RACE_STORE, ...payAsYouGo, freeReservationsGranted: 0 },
    ]);
    // The reservation marks read the store from the reservation row.
    const reservation = (id: string, storeId: string) => ({
      id,
      storeId,
      customerId: "customer_marks",
      number: id,
      status: "confirmed" as const,
      startDate: new Date("2026-01-20T09:00:00Z"),
      endDate: new Date("2026-01-22T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
    });
    await louezDb.db
      .insert(louezDb.reservations)
      .values([
        reservation("res_marks_free", FREE_STORE),
        reservation("res_marks_paid", FREE_STORE),
        reservation("res_marks_online", PAID_STORE),
        reservation("res_marks_upgrade", UPGRADE_STORE),
        reservation("res_marks_race", RACE_STORE),
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

  test("a fee row marks its month and reservation; a free row the free credits too", async () => {
    await metering.recordReservationFee({
      storeId: FREE_STORE,
      reservationId: "res_marks_free",
      source: "manual",
      at: JANUARY,
    });
    assert.deepEqual(await readMarks(FREE_STORE), [
      "reservation res_marks_free v1",
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
      "reservation res_marks_free v1",
      "reservation res_marks_paid v1",
      `legacy_store ${FREE_STORE} v1`,
      `legacy_month ${FREE_STORE}:2026-01 v2`,
    ]);

    // Voiding the pending fee changes the month; voiding the free one returns the credit.
    assert.deepEqual(await metering.voidReservationFee("res_marks_paid"), { voided: true });
    assert.deepEqual(await metering.voidReservationFee("res_marks_free"), { voided: true });
    assert.deepEqual(await readMarks(FREE_STORE), [
      "reservation res_marks_free v2",
      "reservation res_marks_paid v2",
      `legacy_store ${FREE_STORE} v2`,
      `legacy_month ${FREE_STORE}:2026-01 v4`,
    ]);

    // Nothing left to void: no write, no mark.
    assert.deepEqual(await metering.voidReservationFee("res_marks_free"), { voided: false });
    assert.equal((await readMarks(FREE_STORE)).length, 4);
  });

  test("a fee reversal marks the month and the reservation; the month-end run the month", async () => {
    await metering.recordReservationFee({
      storeId: PAID_STORE,
      reservationId: "res_marks_online",
      source: "online",
      collectedAmountCents: 150,
      stripePaymentIntentId: "pi_marks_online",
      at: JANUARY,
    });
    assert.deepEqual(await readMarks(PAID_STORE), [
      "reservation res_marks_online v1",
      `legacy_month ${PAID_STORE}:2026-01 v1`,
    ]);

    const { rows } = await metering.getReversibleFees("pi_marks_online");
    await metering.recordFeeReversals(metering.distributeReversal(rows, 50));
    assert.deepEqual(await readMarks(PAID_STORE), [
      "reservation res_marks_online v2",
      `legacy_month ${PAID_STORE}:2026-01 v2`,
    ]);

    // Everything was collected at source: the run claims the month and voids it, with no
    // Stripe call. The claim and the void each mark it.
    const billing = await import("./billing");
    const outcome = await billing.billStoreForMonth(PAID_STORE, "2026-01");
    assert.equal(outcome.status, "void");
    assert.deepEqual(await readMarks(PAID_STORE), [
      "reservation res_marks_online v2",
      `legacy_month ${PAID_STORE}:2026-01 v4`,
    ]);
  });

  test("a manual fee later taken at source marks its reservation", async () => {
    // The reservation snapshot of an older Stripe payment reads its fee from this row.
    const fee = {
      storeId: UPGRADE_STORE,
      reservationId: "res_marks_upgrade",
      at: JANUARY,
    } as const;
    await metering.recordReservationFee({ ...fee, source: "manual" });
    const upgraded = await metering.recordReservationFee({
      ...fee,
      source: "online",
      collectedAmountCents: 123,
      stripePaymentIntentId: "pi_marks_upgrade",
    });
    assert.equal(upgraded.reason, "upgraded_to_collected");
    assert.deepEqual(await readMarks(UPGRADE_STORE), [
      "reservation res_marks_upgrade v2",
      `legacy_month ${UPGRADE_STORE}:2026-01 v2`,
    ]);
  });

  test("two records of one rental at once write one fee; the second is already recorded", async () => {
    // Both find no fee, then wait on the store's row lock: the second insert hits the
    // dedup key. drizzle reports it with the MySQL code on the error's cause.
    const record = () =>
      metering.recordReservationFee({
        storeId: RACE_STORE,
        reservationId: "res_marks_race",
        source: "manual",
        at: JANUARY,
      });
    const outcomes = await raceOnLockedRow(
      database,
      { table: "subscriptions", id: "sub_marks_race" },
      [record, record],
    );

    assert.deepEqual(outcomes.map((outcome) => outcome.reason ?? "recorded").sort(), [
      "already_recorded",
      "recorded",
    ]);
    const fees = await louezDb.db
      .select({ status: louezDb.platformFees.status, cents: louezDb.platformFees.amountCents })
      .from(louezDb.platformFees)
      .where(eq(louezDb.platformFees.reservationId, "res_marks_race"));
    assert.deepEqual(fees, [{ status: "pending", cents: 123 }]);
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

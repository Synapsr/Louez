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

  test("a fee refund marks the month and the reservation; the month-end run the month", async () => {
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

    // The row predates the fee id: it is found through its PaymentIntent.
    const refund = {
      applicationFeeId: "fee_marks_online",
      paymentIntentId: "pi_marks_online",
      feeRefundedMinor: 50,
    };
    await metering.recordApplicationFeeRefund(refund);
    assert.deepEqual(await readMarks(PAID_STORE), [
      "reservation res_marks_online v2",
      `legacy_month ${PAID_STORE}:2026-01 v2`,
    ]);
    // Stripe's amount again: nothing changes, nothing is marked.
    await metering.recordApplicationFeeRefund(refund);
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

  describe("application fee refunds on the legacy rows", () => {
    const STORE = "store_fee_refund";
    let counter = 0;

    /** A reservation's `res:` and `mkt:` rows on one PaymentIntent, oldest first. */
    async function feeRows(rows: {
      res: {
        source: "online" | "manual";
        status: "collected" | "pending" | "billed";
        cents: number;
      };
      mkt?: { cents: number };
      applicationFeeId: string | null;
    }) {
      const reservationId = `res_fee_refund_${++counter}`;
      const paymentIntentId = `pi_fee_refund_${counter}`;
      const common = {
        storeId: STORE,
        reservationId,
        currency: "eur",
        billingMonth: "2026-01",
        stripePaymentIntentId: paymentIntentId,
      };
      await louezDb.db.insert(louezDb.platformFees).values([
        {
          ...common,
          id: `fee_res_${counter}`,
          dedupKey: `res:${reservationId}`,
          amountCents: rows.res.cents,
          source: rows.res.source,
          status: rows.res.status,
          monthlyIndex: 1,
          stripeApplicationFeeId: rows.res.source === "online" ? rows.applicationFeeId : null,
          createdAt: new Date("2026-01-15T10:00:00Z"),
        },
        ...(rows.mkt
          ? [
              {
                ...common,
                id: `fee_mkt_${counter}`,
                dedupKey: `mkt:${reservationId}`,
                amountCents: rows.mkt.cents,
                source: "marketplace_online" as const,
                status: "collected" as const,
                stripeApplicationFeeId: rows.applicationFeeId,
                createdAt: new Date("2026-01-15T10:00:01Z"),
              },
            ]
          : []),
      ]);
      return { reservationId, paymentIntentId };
    }

    async function readRows(reservationId: string) {
      const fees = louezDb.platformFees;
      return louezDb.db
        .select({ key: fees.dedupKey, status: fees.status, reversed: fees.amountReversedCents })
        .from(fees)
        .where(eq(fees.reservationId, reservationId))
        .orderBy(asc(fees.dedupKey));
    }

    test("a manual row on the PaymentIntent is never reversed, billed or not", async () => {
      // The 2026-10-27 bug: the marketplace fee was taken at source, the reservation fee
      // did not fit and was billed at month end. The refund reversed both by PaymentIntent.
      const { reservationId, paymentIntentId } = await feeRows({
        res: { source: "manual", status: "billed", cents: 300 },
        mkt: { cents: 150 },
        applicationFeeId: "fee_bug_1027",
      });
      await metering.recordApplicationFeeRefund({
        applicationFeeId: "fee_bug_1027",
        paymentIntentId,
        feeRefundedMinor: 150,
      });
      assert.deepEqual(await readRows(reservationId), [
        { key: `mkt:${reservationId}`, status: "reversed", reversed: 150 },
        { key: `res:${reservationId}`, status: "billed", reversed: 0 },
      ]);
    });

    test("Stripe's refunded amount is split in proportion, the last row taking the rest", async () => {
      const { reservationId, paymentIntentId } = await feeRows({
        res: { source: "online", status: "collected", cents: 300 },
        mkt: { cents: 150 },
        applicationFeeId: "fee_split",
      });
      // 100 of 450: the reservation row, created first, gets round(100 × 300 / 450) = 67.
      await metering.recordApplicationFeeRefund({
        applicationFeeId: "fee_split",
        paymentIntentId,
        feeRefundedMinor: 100,
      });
      assert.deepEqual(await readRows(reservationId), [
        { key: `mkt:${reservationId}`, status: "collected", reversed: 33 },
        { key: `res:${reservationId}`, status: "collected", reversed: 67 },
      ]);
      // The whole fee: both rows reversed.
      await metering.recordApplicationFeeRefund({
        applicationFeeId: "fee_split",
        paymentIntentId,
        feeRefundedMinor: 450,
      });
      assert.deepEqual(await readRows(reservationId), [
        { key: `mkt:${reservationId}`, status: "reversed", reversed: 150 },
        { key: `res:${reservationId}`, status: "reversed", reversed: 300 },
      ]);
    });

    test("with platform billing off, the ledger is left as it is", async () => {
      const { reservationId, paymentIntentId } = await feeRows({
        res: { source: "online", status: "collected", cents: 300 },
        applicationFeeId: "fee_off",
      });
      process.env.LOUEZ_BILLING = "off";
      await metering.recordApplicationFeeRefund({
        applicationFeeId: "fee_off",
        paymentIntentId,
        feeRefundedMinor: 300,
      });
      assert.deepEqual(await readRows(reservationId), [
        { key: `res:${reservationId}`, status: "collected", reversed: 0 },
      ]);
    });
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

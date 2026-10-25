import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The dashboard's payment writes on a migrated database: the rows, their billing
// facts and the reservation's mark, in one transaction (louez-billing docs/api,
// README §5.2, Q4, Q7). The Stripe calls happen before these writes, in the
// actions, so none is made here.

const STORE = "store_pay_writes";
const OTHER_STORE = "store_pay_other";
const NOW = new Date("2026-03-10T10:00:00.000Z");

describe("dashboard payment writes (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let writes: typeof import("./dashboard-payment-writes");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("dashboard_payment_writes");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    writes = await import("./dashboard-payment-writes");
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

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function createReservation(
    options: { storeId?: string; currency?: string | null; depositStatus?: "authorized" } = {},
  ) {
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: options.storeId ?? STORE,
      customerId: "customer",
      number: id,
      status: "confirmed",
      startDate: new Date("2026-03-12T09:00:00.000Z"),
      endDate: new Date("2026-03-14T09:00:00.000Z"),
      subtotalAmount: "100.00",
      depositAmount: "50.00",
      totalAmount: "100.00",
      currency: options.currency ?? null,
      depositStatus: options.depositStatus ?? "card_saved",
      depositPaymentIntentId: options.depositStatus ? "pi_hold" : null,
      source: "manual",
    });
    return id;
  }

  async function createPayment(
    reservationId: string,
    values: {
      type: "rental" | "deposit_capture" | "deposit_hold";
      method: "cash" | "stripe";
      status?: "completed" | "authorized";
      currency?: string;
      amount?: string;
    },
  ) {
    const id = nextId("pay");
    await louezDb.db.insert(louezDb.payments).values({
      id,
      reservationId,
      amount: values.amount ?? "50.00",
      type: values.type,
      method: values.method,
      status: values.status ?? "completed",
      stripePaymentIntentId: values.method === "stripe" ? "pi_hold" : null,
      currency: values.currency ?? "EUR",
    });
    return id;
  }

  async function readPayment(id: string) {
    const p = louezDb.payments;
    const [row] = await louezDb.db
      .select({
        amount: p.amount,
        type: p.type,
        method: p.method,
        status: p.status,
        currency: p.currency,
        grossMinor: p.grossMinor,
        insuranceShareMinor: p.insuranceShareMinor,
        origin: p.origin,
        stripeChargeId: p.stripeChargeId,
        stripeAccountId: p.stripeAccountId,
        refundOfPaymentId: p.refundOfPaymentId,
        capturedAmount: p.capturedAmount,
        notes: p.notes,
      })
      .from(p)
      .where(eq(p.id, id));
    return row;
  }

  async function readPaymentsOfType(
    reservationId: string,
    type: "deposit_capture" | "deposit_hold",
  ) {
    const p = louezDb.payments;
    return louezDb.db
      .select({ id: p.id })
      .from(p)
      .where(and(eq(p.reservationId, reservationId), eq(p.type, type)));
  }

  async function readMark(reservationId: string) {
    const q = louezDb.billingSyncQueue;
    const [row] = await louezDb.db
      .select({ storeId: q.storeId, version: q.version, status: q.status })
      .from(q)
      .where(and(eq(q.aggregateType, "reservation"), eq(q.aggregateId, reservationId)));
    return row ?? null;
  }

  async function readDeposit(reservationId: string) {
    const r = louezDb.reservations;
    const [row] = await louezDb.db
      .select({
        depositStatus: r.depositStatus,
        depositPaymentIntentId: r.depositPaymentIntentId,
        depositAuthorizationExpiresAt: r.depositAuthorizationExpiresAt,
      })
      .from(r)
      .where(eq(r.id, reservationId));
    return row;
  }

  describe("a manual refund", () => {
    test("of a manual payment takes the reservation's currency, not the payment's EUR default", async () => {
      const reservationId = await createReservation({ currency: "USD" });
      const originalId = await createPayment(reservationId, { type: "rental", method: "cash" });
      const refundId = nextId("pay");

      await louezDb.db.transaction((tx) =>
        writes.insertManualRefund(tx, {
          id: refundId,
          reservationId,
          storeId: STORE,
          storeSettings: { currency: "EUR" },
          reservationCurrency: "USD",
          original: { id: originalId, method: "cash", currency: "EUR" },
          type: "rental",
          method: "transfer",
          amount: "20.00",
          paidAt: NOW,
          notes: null,
        }),
      );

      assert.deepEqual(await readPayment(refundId), {
        amount: "20.00",
        type: "rental",
        method: "transfer",
        status: "completed",
        currency: "USD",
        grossMinor: 2000,
        insuranceShareMinor: 0,
        origin: "manual",
        stripeChargeId: null,
        stripeAccountId: null,
        refundOfPaymentId: originalId,
        capturedAmount: null,
        notes: null,
      });
      assert.deepEqual(await readMark(reservationId), {
        storeId: STORE,
        version: 1,
        status: "pending",
      });
    });

    test("of a Stripe capture keeps the charge currency", async () => {
      const reservationId = await createReservation();
      const originalId = await createPayment(reservationId, {
        type: "deposit_capture",
        method: "stripe",
        currency: "GBP",
      });
      const refundId = nextId("pay");

      await louezDb.db.transaction((tx) =>
        writes.insertManualRefund(tx, {
          id: refundId,
          reservationId,
          storeId: STORE,
          storeSettings: { currency: "EUR" },
          reservationCurrency: null,
          original: { id: originalId, method: "stripe", currency: "GBP" },
          type: "deposit_return",
          method: "cash",
          amount: "5.00",
          paidAt: NOW,
          notes: "returned",
        }),
      );

      const refund = await readPayment(refundId);
      assert.equal(refund?.currency, "GBP");
      assert.equal(refund?.grossMinor, 500);
      assert.equal(refund?.type, "deposit_return");
    });
  });

  test("a recorded payment on another store's reservation writes nothing", async () => {
    const reservationId = await createReservation({ storeId: OTHER_STORE });
    const paymentId = nextId("pay");

    await assert.rejects(
      louezDb.db.transaction((tx) =>
        writes.insertRecordedPayment(tx, {
          id: paymentId,
          reservationId,
          storeId: STORE,
          storeSettings: { currency: "EUR" },
          type: "rental",
          method: "cash",
          amount: "10.00",
          origin: "manual",
          paidAt: NOW,
          notes: null,
        }),
      ),
      /errors\.reservationNotFound/,
    );
    assert.equal(await readPayment(paymentId), undefined);
    assert.equal(await readMark(reservationId), null);
  });

  test("a deposit hold records the authorization and the hold, with its facts", async () => {
    const reservationId = await createReservation();
    const paymentId = nextId("pay");
    const expiresAt = new Date("2026-03-17T10:00:00.000Z");

    await writes.recordDepositHold(louezDb.db, {
      paymentId,
      reservationId,
      storeId: STORE,
      stripeAccountId: "acct_store",
      paymentIntentId: "pi_new_hold",
      paymentMethodId: "pm_card",
      expiresAt,
      amount: "50.00",
      amountMinor: 5000,
      currency: "EUR",
      now: NOW,
    });

    assert.deepEqual(await readDeposit(reservationId), {
      depositStatus: "authorized",
      depositPaymentIntentId: "pi_new_hold",
      depositAuthorizationExpiresAt: expiresAt,
    });
    const hold = await readPayment(paymentId);
    assert.equal(hold?.type, "deposit_hold");
    assert.equal(hold?.status, "authorized");
    assert.equal(hold?.grossMinor, 5000);
    assert.equal(hold?.insuranceShareMinor, 0);
    assert.equal(hold?.origin, "deposit");
    assert.equal(hold?.stripeAccountId, "acct_store");
    assert.equal((await readMark(reservationId))?.version, 1);
  });

  test("a deposit capture completes the hold and records the charge", async () => {
    const reservationId = await createReservation({ depositStatus: "authorized" });
    const holdId = await createPayment(reservationId, {
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
    });
    // A hold on another reservation stays as it is.
    const otherReservationId = await createReservation({ depositStatus: "authorized" });
    const otherHoldId = await createPayment(otherReservationId, {
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
    });
    const captureId = nextId("pay");

    await writes.recordDepositCapture(louezDb.db, {
      capturePaymentId: captureId,
      reservationId,
      storeId: STORE,
      stripeAccountId: "acct_store",
      paymentIntentId: "pi_hold",
      stripeChargeId: "ch_capture",
      amount: "30.00",
      capturedMinor: 3000,
      currency: "EUR",
      reason: "broken wheel",
      now: NOW,
    });

    assert.equal((await readDeposit(reservationId))?.depositStatus, "captured");
    const hold = await readPayment(holdId);
    assert.equal(hold?.status, "completed");
    assert.equal(hold?.capturedAmount, "30.00");
    assert.equal(hold?.notes, "broken wheel");
    assert.deepEqual(await readPayment(captureId), {
      amount: "30.00",
      type: "deposit_capture",
      method: "stripe",
      status: "completed",
      currency: "EUR",
      grossMinor: 3000,
      insuranceShareMinor: 0,
      origin: "deposit",
      stripeChargeId: "ch_capture",
      stripeAccountId: "acct_store",
      refundOfPaymentId: null,
      capturedAmount: null,
      notes: "broken wheel",
    });
    assert.equal((await readPaymentsOfType(reservationId, "deposit_capture")).length, 1);
    assert.equal((await readMark(reservationId))?.version, 1);

    assert.equal((await readPayment(otherHoldId))?.status, "authorized");
    assert.equal(await readMark(otherReservationId), null);
  });

  test("a deposit release cancels the hold", async () => {
    const reservationId = await createReservation({ depositStatus: "authorized" });
    const holdId = await createPayment(reservationId, {
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
    });

    await writes.recordDepositRelease(louezDb.db, { reservationId, storeId: STORE, now: NOW });

    assert.equal((await readDeposit(reservationId))?.depositStatus, "released");
    assert.equal((await readPayment(holdId))?.status, "cancelled");
    assert.equal((await readMark(reservationId))?.version, 1);
  });

  test("without the billing service, the rows are written and nothing is marked", async () => {
    delete process.env.LOUEZ_BILLING;
    const reservationId = await createReservation({ depositStatus: "authorized" });
    const holdId = await createPayment(reservationId, {
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
    });

    await writes.recordDepositRelease(louezDb.db, { reservationId, storeId: STORE, now: NOW });

    assert.equal((await readPayment(holdId))?.status, "cancelled");
    assert.equal(await readMark(reservationId), null);
  });
});

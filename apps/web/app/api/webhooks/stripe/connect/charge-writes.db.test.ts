import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { DisputeInput } from "./dispute-facts";

// The Connect webhook's writes on a charge, with their billing marks, on a migrated
// database (louez-billing docs/api, README §5.2 and Q15).

const STORE = "store_connect_writes";
const ACCOUNT = "acct_connect_writes";
const WITHDRAWN = Date.UTC(2026, 9, 1, 10) / 1000;
const REINSTATED = Date.UTC(2026, 10, 20, 9) / 1000;
const EVENT_AT = new Date(Date.UTC(2026, 10, 20, 9, 0, 30));

describe("Connect webhook charge writes (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let writes: typeof import("./charge-writes");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("connect_charge_writes");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    writes = await import("./charge-writes");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Connect writes",
      slug: "connect-writes",
      stripeAccountId: ACCOUNT,
    });
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
    ] satisfies Array<[string, string | undefined]>) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** A confirmed reservation with one completed Stripe payment. */
  async function createPaidReservation(payment: {
    type?: "rental" | "deposit_hold" | "deposit_capture";
    chargeId: string | null;
    paymentIntentId: string;
    amount?: string;
    /** The refund id webhooks before 2026-08-20 stamped on the charge (README Q7, shape 1). */
    stampedRefundId?: string;
  }) {
    const reservationId = `res_connect_${++counter}`;
    const paymentId = `pay_connect_${counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "customer",
      number: reservationId,
      status: "confirmed",
      startDate: new Date("2026-10-01T09:00:00Z"),
      endDate: new Date("2026-10-03T09:00:00Z"),
      subtotalAmount: "123.45",
      depositAmount: "0.00",
      totalAmount: "123.45",
    });
    await louezDb.db.insert(louezDb.payments).values({
      id: paymentId,
      reservationId,
      amount: payment.amount ?? "123.45",
      type: payment.type ?? "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: payment.paymentIntentId,
      stripeChargeId: payment.chargeId,
      stripeRefundId: payment.stampedRefundId ?? null,
      grossMinor: 12_345,
      currency: "EUR",
      paidAt: new Date("2026-10-01T09:30:00Z"),
    });
    return { reservationId, paymentId };
  }

  const queue = () => {
    const rows = louezDb.billingSyncQueue;
    return louezDb.db
      .select({
        type: rows.aggregateType,
        id: rows.aggregateId,
        storeId: rows.storeId,
        version: rows.version,
      })
      .from(rows)
      .orderBy(rows.aggregateType, rows.aggregateId);
  };

  const readDispute = async (id: string) => {
    const [row] = await louezDb.db
      .select({
        paymentId: louezDb.paymentDisputes.paymentId,
        reservationId: louezDb.paymentDisputes.reservationId,
        amountMinor: louezDb.paymentDisputes.amountMinor,
        currency: louezDb.paymentDisputes.currency,
        status: louezDb.paymentDisputes.status,
        stripeStatus: louezDb.paymentDisputes.stripeStatus,
        openedAt: louezDb.paymentDisputes.openedAt,
        closedAt: louezDb.paymentDisputes.closedAt,
      })
      .from(louezDb.paymentDisputes)
      .where(eq(louezDb.paymentDisputes.id, id));
    return row;
  };

  function dispute(overrides: Partial<DisputeInput> & Pick<DisputeInput, "id" | "charge">) {
    return {
      amount: 12_345,
      currency: "eur",
      created: WITHDRAWN,
      payment_intent: null,
      status: "needs_response",
      balance_transactions: [{ amount: -12_345, created: WITHDRAWN }],
      ...overrides,
    } satisfies DisputeInput;
  }

  test("a chargeback is stored open, then won, and marks its reservation each time", async () => {
    const { reservationId, paymentId } = await createPaidReservation({
      chargeId: "ch_dispute_won",
      paymentIntentId: "pi_dispute_won",
    });
    const opened = dispute({ id: "dp_won", charge: "ch_dispute_won" });

    const created = await writes.recordChargeDispute({
      dispute: opened,
      eventType: "charge.dispute.created",
      eventCreatedAt: new Date(WITHDRAWN * 1000),
      accountId: ACCOUNT,
    });
    assert.deepEqual(created, { recorded: true, paymentId, reservationId });
    assert.deepEqual(await readDispute("dp_won"), {
      paymentId,
      reservationId,
      amountMinor: 12_345,
      currency: "EUR",
      status: "open",
      stripeStatus: "needs_response",
      openedAt: new Date(WITHDRAWN * 1000),
      closedAt: null,
    });
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 1 },
    ]);

    await writes.recordChargeDispute({
      dispute: dispute({
        id: "dp_won",
        charge: "ch_dispute_won",
        status: "won",
        balance_transactions: [
          { amount: -12_345, created: WITHDRAWN },
          { amount: 12_345, created: REINSTATED },
        ],
      }),
      eventType: "charge.dispute.closed",
      eventCreatedAt: EVENT_AT,
      accountId: ACCOUNT,
    });
    // The creation event delivered again after the close changes nothing.
    await writes.recordChargeDispute({
      dispute: opened,
      eventType: "charge.dispute.funds_withdrawn",
      eventCreatedAt: new Date(WITHDRAWN * 1000),
      accountId: ACCOUNT,
    });
    assert.deepEqual(await readDispute("dp_won"), {
      paymentId,
      reservationId,
      amountMinor: 12_345,
      currency: "EUR",
      status: "won",
      stripeStatus: "won",
      openedAt: new Date(WITHDRAWN * 1000),
      closedAt: new Date(REINSTATED * 1000),
    });
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 3 },
    ]);
  });

  test("an inquiry is stored without a withdrawal time", async () => {
    await createPaidReservation({ chargeId: "ch_inquiry", paymentIntentId: "pi_inquiry" });
    await writes.recordChargeDispute({
      dispute: dispute({
        id: "dp_inquiry",
        charge: "ch_inquiry",
        status: "warning_needs_response",
        balance_transactions: [],
      }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
      accountId: ACCOUNT,
    });
    const row = await readDispute("dp_inquiry");
    assert.equal(row?.stripeStatus, "warning_needs_response");
    assert.equal(row?.openedAt, null);
  });

  test("a dispute sent by another connected account is ignored", async () => {
    await createPaidReservation({ chargeId: "ch_other_account", paymentIntentId: "pi_other" });
    const result = await writes.recordChargeDispute({
      dispute: dispute({ id: "dp_other_account", charge: "ch_other_account" }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
      accountId: "acct_someone_else",
    });
    assert.deepEqual(result, { recorded: false, reason: "payment_not_found" });
    assert.equal(await readDispute("dp_other_account"), undefined);
    assert.deepEqual(await queue(), []);
  });

  test("a payment stored without its charge id is found through its PaymentIntent", async () => {
    const hold = await createPaidReservation({
      type: "deposit_hold",
      chargeId: null,
      paymentIntentId: "pi_deposit",
    });
    const captureId = "pay_connect_capture";
    await louezDb.db.insert(louezDb.payments).values({
      id: captureId,
      reservationId: hold.reservationId,
      amount: "50.00",
      type: "deposit_capture",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: "pi_deposit",
      currency: "EUR",
    });
    const result = await writes.recordChargeDispute({
      dispute: dispute({ id: "dp_deposit", charge: "ch_deposit", payment_intent: "pi_deposit" }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
      accountId: ACCOUNT,
    });
    assert.deepEqual(result, {
      recorded: true,
      paymentId: captureId,
      reservationId: hold.reservationId,
    });
  });

  test("a charge stamped with its refund id is found, and not the refund row beside it", async () => {
    const { reservationId, paymentId } = await createPaidReservation({
      chargeId: "ch_stamped",
      paymentIntentId: "pi_stamped",
      amount: "100.00",
      stampedRefundId: "re_stamped",
    });
    // A dashboard refund before 2026-08-20 (shape 2): its own row, with the charge
    // id copied and no PaymentIntent. Its id sorts before the charge's.
    await louezDb.db.insert(louezDb.payments).values({
      id: "pay_a_shape2_refund",
      reservationId,
      amount: "23.45",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripeChargeId: "ch_stamped",
      stripeRefundId: "re_stamped",
      currency: "EUR",
    });

    const result = await writes.recordChargeDispute({
      dispute: dispute({ id: "dp_stamped", charge: "ch_stamped" }),
      eventType: "charge.dispute.funds_withdrawn",
      eventCreatedAt: new Date(WITHDRAWN * 1000),
      accountId: ACCOUNT,
    });
    assert.deepEqual(result, { recorded: true, paymentId, reservationId });
    assert.equal((await readDispute("dp_stamped"))?.paymentId, paymentId);
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 1 },
    ]);
  });

  test("a refunded charge nets its payment, keeps the gross and marks the reservation", async () => {
    const { reservationId, paymentId } = await createPaidReservation({
      chargeId: "ch_refund",
      paymentIntentId: "pi_refund",
    });
    const readPayment = async () => {
      const [row] = await louezDb.db
        .select({
          amount: louezDb.payments.amount,
          status: louezDb.payments.status,
          grossMinor: louezDb.payments.grossMinor,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.id, paymentId));
      return row;
    };

    await writes.netRefundedChargePayment({
      paymentId,
      reservationId,
      charge: {
        id: "ch_refund",
        amount: 12_345,
        amount_refunded: 2_345,
        refunded: false,
        currency: "eur",
      },
    });
    assert.deepEqual(await readPayment(), {
      amount: "100.00",
      status: "completed",
      grossMinor: 12_345,
    });
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 1 },
    ]);

    await writes.netRefundedChargePayment({
      paymentId,
      reservationId,
      charge: {
        id: "ch_refund",
        amount: 12_345,
        amount_refunded: 12_345,
        refunded: true,
        currency: "eur",
      },
    });
    assert.deepEqual(await readPayment(), {
      amount: "0.00",
      status: "refunded",
      grossMinor: 12_345,
    });
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 2 },
    ]);
  });

  test("without the billing service, the writes happen and nothing is queued", async () => {
    delete process.env.BILLING_SERVICE_URL;
    const { reservationId, paymentId } = await createPaidReservation({
      chargeId: "ch_self_host",
      paymentIntentId: "pi_self_host",
    });
    await writes.netRefundedChargePayment({
      paymentId,
      reservationId,
      charge: {
        id: "ch_self_host",
        amount: 12_345,
        amount_refunded: 12_345,
        refunded: true,
        currency: "eur",
      },
    });
    await writes.recordChargeDispute({
      dispute: dispute({ id: "dp_self_host", charge: "ch_self_host" }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
      accountId: ACCOUNT,
    });
    assert.equal((await readDispute("dp_self_host"))?.status, "open");
    assert.deepEqual(await queue(), []);
  });
});

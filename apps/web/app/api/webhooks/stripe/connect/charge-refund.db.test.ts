import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as nodeModule from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { asc, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ChargeRefundStripe, RefundedChargeEvent } from "./charge-refund";

// `charge.refunded` on a migrated database (louez-billing design §5.6, docs/api README
// Q7 and fees.md §9), with a fake Stripe: one refund row per Stripe refund whatever the
// payment's kind, the 500 for a charge of a known reservation, and the fee refund.

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The invoice PDF imports "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

const STORE = "store_charge_refund";
const ACCOUNT = "acct_charge_refund";
// Named locks are server-wide: other suites on the same MySQL must not share them.
const RUN = randomBytes(4).toString("hex");
const REFUNDED_AT = Date.UTC(2026, 9, 20, 9) / 1000;

type FakeRefund = Pick<Stripe.Refund, "id" | "amount" | "created" | "status">;

function fakeStripe() {
  const refunds = new Map<string, FakeRefund[]>();
  const intentMetadata = new Map<string, Stripe.Metadata>();
  const feeRefunds: Array<{ feeId: string; amount: number }> = [];
  const calls = { listRefunds: 0, retrieveCharge: 0 };
  const charges = new Map<string, { amount: number; refunded: number; feeId: string }>();
  const port: ChargeRefundStripe = {
    async listRefunds(chargeId, accountId) {
      assert.equal(accountId, ACCOUNT);
      calls.listRefunds++;
      return refunds.get(chargeId) ?? [];
    },
    async paymentIntentMetadata(paymentIntentId) {
      return intentMetadata.get(paymentIntentId) ?? {};
    },
    feeReversal: {
      async retrieveCharge(chargeId) {
        calls.retrieveCharge++;
        const charge = charges.get(chargeId);
        if (!charge) throw new Error(`no such charge: ${chargeId}`);
        return {
          id: chargeId,
          amount: charge.amount,
          amount_refunded: charge.refunded,
          application_fee: charge.feeId,
          payment_intent: null,
        };
      },
      async retrieveApplicationFee(feeId) {
        const refunded = feeRefunds
          .filter((refund) => refund.feeId === feeId)
          .reduce((sum, refund) => sum + refund.amount, 0);
        return { id: feeId, amount: 300, amount_refunded: refunded };
      },
      async listDisputes() {
        return [];
      },
      async refundApplicationFee(feeId, amount) {
        feeRefunds.push({ feeId, amount });
      },
    },
  };
  return { port, refunds, intentMetadata, feeRefunds, calls, charges };
}

describe("charge.refunded (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let refund: typeof import("./charge-refund");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("charge_refund");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    refund = await import("./charge-refund");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Charge refund",
      slug: "charge-refund",
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

  async function createReservation() {
    const reservationId = `res_refund_${++counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "customer",
      number: reservationId,
      status: "confirmed",
      startDate: new Date("2026-10-01T09:00:00Z"),
      endDate: new Date("2026-10-03T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "50.00",
      totalAmount: "100.00",
    });
    return reservationId;
  }

  async function insertPayment(payment: {
    reservationId: string;
    type: "rental" | "deposit_hold" | "deposit_capture";
    amount: string;
    paymentIntentId: string;
    chargeId: string | null;
    status?: "completed" | "authorized";
  }) {
    const id = `pay_refund_${++counter}`;
    await louezDb.db.insert(louezDb.payments).values({
      id,
      reservationId: payment.reservationId,
      amount: payment.amount,
      type: payment.type,
      method: "stripe",
      status: payment.status ?? "completed",
      stripePaymentIntentId: payment.paymentIntentId,
      stripeChargeId: payment.chargeId,
      currency: "EUR",
      paidAt: new Date("2026-10-01T09:30:00Z"),
    });
    return id;
  }

  const charge = (
    overrides: Partial<RefundedChargeEvent> & Pick<RefundedChargeEvent, "id">,
  ): RefundedChargeEvent => ({
    amount: 5_000,
    amount_refunded: 5_000,
    refunded: true,
    currency: "eur",
    payment_intent: null,
    application_fee: null,
    metadata: {},
    ...overrides,
  });

  const rowsOf = (reservationId: string) =>
    louezDb.db
      .select({
        id: louezDb.payments.id,
        type: louezDb.payments.type,
        amount: louezDb.payments.amount,
        status: louezDb.payments.status,
        chargeId: louezDb.payments.stripeChargeId,
        refundId: louezDb.payments.stripeRefundId,
        refundOf: louezDb.payments.refundOfPaymentId,
        grossMinor: louezDb.payments.grossMinor,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId))
      .orderBy(asc(louezDb.payments.createdAt), asc(louezDb.payments.id));

  const queue = () =>
    louezDb.db
      .select({
        type: louezDb.billingSyncQueue.aggregateType,
        id: louezDb.billingSyncQueue.aggregateId,
      })
      .from(louezDb.billingSyncQueue)
      .orderBy(asc(louezDb.billingSyncQueue.aggregateId));

  test("a refunded deposit capture nets the capture and gets a deposit return row", async () => {
    const stripe = fakeStripe();
    const reservationId = await createReservation();
    const paymentIntentId = `pi_${RUN}_deposit`;
    // The hold shares the PaymentIntent; the capture holds the money and the charge id.
    await insertPayment({
      reservationId,
      type: "deposit_hold",
      amount: "50.00",
      paymentIntentId,
      chargeId: null,
    });
    const captureId = await insertPayment({
      reservationId,
      type: "deposit_capture",
      amount: "50.00",
      paymentIntentId,
      chargeId: `ch_${RUN}_deposit`,
    });
    stripe.refunds.set(`ch_${RUN}_deposit`, [
      { id: `re_${RUN}_deposit`, amount: 2_000, created: REFUNDED_AT, status: "succeeded" },
    ]);

    const result = await refund.handleChargeRefunded(
      charge({
        id: `ch_${RUN}_deposit`,
        amount: 5_000,
        amount_refunded: 2_000,
        refunded: false,
        payment_intent: paymentIntentId,
      }),
      ACCOUNT,
      stripe.port,
    );
    assert.deepEqual(result, { status: "recorded", paymentId: captureId, refundRows: 1 });
    const rows = await rowsOf(reservationId);
    const capture = rows.find((row) => row.id === captureId);
    assert.deepEqual(capture && { amount: capture.amount, status: capture.status }, {
      amount: "30.00",
      status: "completed",
    });
    assert.deepEqual(
      rows
        .filter((row) => row.refundId !== null)
        .map((row) => [
          row.type,
          row.amount,
          row.status,
          row.refundId,
          row.refundOf,
          row.grossMinor,
        ]),
      [["deposit_return", "20.00", "completed", `re_${RUN}_deposit`, captureId, 2_000]],
    );
    assert.deepEqual(await queue(), [{ type: "reservation", id: reservationId }]);
    // No application fee on the charge: no Stripe read for it.
    assert.equal(stripe.calls.retrieveCharge, 0);
  });

  test("every Stripe refund gets one row, once; a failed refund none", async () => {
    const stripe = fakeStripe();
    const reservationId = await createReservation();
    const chargeId = `ch_${RUN}_rental`;
    const paymentId = await insertPayment({
      reservationId,
      type: "rental",
      amount: "100.00",
      paymentIntentId: `pi_${RUN}_rental`,
      chargeId,
    });
    stripe.refunds.set(chargeId, [
      { id: `re_${RUN}_a`, amount: 3_000, created: REFUNDED_AT, status: "succeeded" },
      { id: `re_${RUN}_b`, amount: 1_000, created: REFUNDED_AT + 60, status: "pending" },
      { id: `re_${RUN}_c`, amount: 6_000, created: REFUNDED_AT + 120, status: "failed" },
    ]);
    const event = charge({
      id: chargeId,
      amount: 10_000,
      amount_refunded: 4_000,
      refunded: false,
      payment_intent: `pi_${RUN}_rental`,
    });

    await refund.handleChargeRefunded(event, ACCOUNT, stripe.port);
    await refund.handleChargeRefunded(event, ACCOUNT, stripe.port);

    const rows = await rowsOf(reservationId);
    assert.deepEqual(
      rows
        .filter((row) => row.refundId !== null)
        .map((row) => [row.type, row.refundId, row.amount, row.refundOf]),
      [
        ["rental", `re_${RUN}_a`, "30.00", paymentId],
        ["rental", `re_${RUN}_b`, "10.00", paymentId],
      ],
    );
    assert.equal(rows.find((row) => row.id === paymentId)?.amount, "60.00");
  });

  test("a payment stored without its charge id is found and gets it", async () => {
    const stripe = fakeStripe();
    const reservationId = await createReservation();
    const paymentId = await insertPayment({
      reservationId,
      type: "rental",
      amount: "100.00",
      paymentIntentId: `pi_${RUN}_no_charge`,
      chargeId: null,
    });
    const result = await refund.handleChargeRefunded(
      charge({
        id: `ch_${RUN}_no_charge`,
        amount: 10_000,
        amount_refunded: 10_000,
        payment_intent: `pi_${RUN}_no_charge`,
      }),
      ACCOUNT,
      stripe.port,
    );
    assert.equal(result.status, "recorded");
    const [row] = await rowsOf(reservationId);
    assert.deepEqual(row && [row.id, row.chargeId, row.status, row.amount], [
      paymentId,
      `ch_${RUN}_no_charge`,
      "refunded",
      "0.00",
    ]);
  });

  test("a charge of a known reservation with no payment yet answers 500", async () => {
    const stripe = fakeStripe();
    const reservationId = await createReservation();
    // The checkout session is not claimed yet: its row has no PaymentIntent. Only the
    // PaymentIntent's metadata names the reservation.
    stripe.intentMetadata.set(`pi_${RUN}_unclaimed`, { reservationId });
    await assert.rejects(
      refund.handleChargeRefunded(
        charge({ id: `ch_${RUN}_unclaimed`, payment_intent: `pi_${RUN}_unclaimed` }),
        ACCOUNT,
        stripe.port,
      ),
      refund.PaymentNotFoundYetError,
    );
    // The charge's own metadata is enough.
    await assert.rejects(
      refund.handleChargeRefunded(
        charge({ id: `ch_${RUN}_unclaimed_2`, metadata: { reservationId } }),
        ACCOUNT,
        stripe.port,
      ),
      refund.PaymentNotFoundYetError,
    );
    // A hold carries the PaymentIntent before its capture is recorded.
    await insertPayment({
      reservationId,
      type: "deposit_hold",
      amount: "50.00",
      paymentIntentId: `pi_${RUN}_hold`,
      chargeId: null,
      status: "authorized",
    });
    await assert.rejects(
      refund.handleChargeRefunded(
        charge({ id: `ch_${RUN}_hold`, payment_intent: `pi_${RUN}_hold` }),
        ACCOUNT,
        stripe.port,
      ),
      refund.PaymentNotFoundYetError,
    );
    assert.equal(stripe.calls.listRefunds, 0);
  });

  test("a charge Louez does not know is acknowledged and left alone", async () => {
    const stripe = fakeStripe();
    const reservationId = await createReservation();
    assert.deepEqual(
      await refund.handleChargeRefunded(
        charge({ id: `ch_${RUN}_foreign`, payment_intent: `pi_${RUN}_foreign` }),
        ACCOUNT,
        stripe.port,
      ),
      { status: "payment_not_found" },
    );
    // A reservation of another account's store is not a known one.
    assert.deepEqual(
      await refund.handleChargeRefunded(
        charge({ id: `ch_${RUN}_other_account`, metadata: { reservationId } }),
        "acct_someone_else",
        stripe.port,
      ),
      { status: "payment_not_found" },
    );
  });

  test("a charge with an application fee refunds its share before anything else", async () => {
    const stripe = fakeStripe();
    const reservationId = await createReservation();
    const chargeId = `ch_${RUN}_fee`;
    const feeId = `fee_${RUN}_fee`;
    await insertPayment({
      reservationId,
      type: "rental",
      amount: "100.00",
      paymentIntentId: `pi_${RUN}_fee`,
      chargeId,
    });
    stripe.charges.set(chargeId, { amount: 10_000, refunded: 5_000, feeId });
    stripe.refunds.set(chargeId, [
      { id: `re_${RUN}_fee`, amount: 5_000, created: REFUNDED_AT, status: "succeeded" },
    ]);
    const event = charge({
      id: chargeId,
      amount: 10_000,
      amount_refunded: 5_000,
      refunded: false,
      payment_intent: `pi_${RUN}_fee`,
      application_fee: feeId,
    });
    await refund.handleChargeRefunded(event, ACCOUNT, stripe.port);
    await refund.handleChargeRefunded(event, ACCOUNT, stripe.port);
    assert.deepEqual(stripe.feeRefunds, [{ feeId, amount: 150 }]);
  });

  test("an event without a connected account writes nothing", async () => {
    const stripe = fakeStripe();
    assert.deepEqual(
      await refund.handleChargeRefunded(
        charge({ id: `ch_${RUN}_no_account` }),
        undefined,
        stripe.port,
      ),
      { status: "missing_account" },
    );
  });
});

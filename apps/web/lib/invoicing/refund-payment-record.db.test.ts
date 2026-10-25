import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// ensureRefundPaymentRecord (service.ts) on a migrated database: the Stripe refund
// row gets its gross amount and marks the reservation in its transaction
// (louez-billing docs/api, README §5.2, Q7).

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

const STORE = "store_refund_rows";
const PAID_AT = new Date("2026-05-02T08:00:00.000Z");

describe("Stripe refund rows (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let service: typeof import("./service");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("refund_payment_record");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    service = await import("./service");
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

  /** A reservation with a completed Stripe rental payment; returns the payment id. */
  async function createStripePayment(currency: string) {
    const reservationId = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "customer",
      number: reservationId,
      status: "confirmed",
      startDate: new Date("2026-05-03T09:00:00.000Z"),
      endDate: new Date("2026-05-04T09:00:00.000Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
    });
    const paymentId = nextId("pay");
    await louezDb.db.insert(louezDb.payments).values({
      id: paymentId,
      reservationId,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripeChargeId: nextId("ch"),
      currency,
    });
    return { reservationId, paymentId };
  }

  async function readRefund(id: string) {
    const p = louezDb.payments;
    const [row] = await louezDb.db
      .select({
        amount: p.amount,
        grossMinor: p.grossMinor,
        insuranceShareMinor: p.insuranceShareMinor,
        origin: p.origin,
        refundOfPaymentId: p.refundOfPaymentId,
      })
      .from(p)
      .where(eq(p.id, id));
    return row;
  }

  async function readMarkVersion(reservationId: string) {
    const q = louezDb.billingSyncQueue;
    const [row] = await louezDb.db
      .select({ version: q.version, storeId: q.storeId })
      .from(q)
      .where(and(eq(q.aggregateType, "reservation"), eq(q.aggregateId, reservationId)));
    if (row) assert.equal(row.storeId, STORE);
    return row?.version ?? null;
  }

  test("a refund row takes Stripe's amount as its gross and marks the reservation once", async () => {
    const { reservationId, paymentId } = await createStripePayment("EUR");
    const input: Parameters<typeof service.ensureRefundPaymentRecord>[0] = {
      originalPaymentId: paymentId,
      stripeRefundId: nextId("re"),
      amount: 12.5,
      grossMinor: 1250,
      currency: "EUR",
      type: "rental",
      paidAt: PAID_AT,
    };

    const refundId = await service.ensureRefundPaymentRecord(input);
    // Stripe redelivers the event: the row exists, nothing changes.
    assert.equal(await service.ensureRefundPaymentRecord(input), refundId);

    assert.deepEqual(await readRefund(refundId), {
      amount: "12.50",
      grossMinor: 1250,
      insuranceShareMinor: 0,
      origin: null,
      refundOfPaymentId: paymentId,
    });
    assert.equal(await readMarkVersion(reservationId), 1);
  });

  test("without Stripe's amount, the gross comes from the amount in the charge's currency", async () => {
    const { paymentId } = await createStripePayment("JPY");

    const refundId = await service.ensureRefundPaymentRecord({
      originalPaymentId: paymentId,
      stripeRefundId: nextId("re"),
      amount: 1500,
      currency: "JPY",
      type: "rental",
      paidAt: PAID_AT,
    });

    assert.equal((await readRefund(refundId))?.grossMinor, 1500);
  });
});

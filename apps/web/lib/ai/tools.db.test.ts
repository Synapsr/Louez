import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { createAITools } from "./tools";

// The assistant's payment tools on a migrated database: each write carries its
// billing facts and marks the reservation for the billing service in the same
// transaction (louez-billing docs/api, README §5.2, Q3, Q4, Q7).

// The status-change module the tools import pulls in "server-only".
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_ai_payments";
const USER = "user_ai_payments";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
} as const;

type Tools = ReturnType<typeof createAITools>;

describe("assistant payment tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let tools: Tools;
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("ai_payments");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    const aiTools = await import("./tools");
    tools = aiTools.createAITools({
      storeId: STORE,
      userId: USER,
      storeName: "AI payments",
      permissions: {
        reservations: "write",
        products: "read",
        customers: "read",
        categories: "read",
        payments: "write",
        analytics: "read",
        settings: "read",
      },
    });

    // The store prices in EUR; the reservation froze USD at creation (contract Q4).
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: USER,
      name: "AI payments",
      slug: "ai-payments",
      settings: SETTINGS,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.billingSyncQueue);
  });

  /** 100.00 tax included, 10.00 of it insurance. */
  async function createReservation(): Promise<string> {
    const id = `res_ai_${++counter}`;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "confirmed",
      startDate: new Date("2027-03-01T09:00:00Z"),
      endDate: new Date("2027-03-03T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
      tulipInsuranceAmount: "10.00",
      currency: "USD",
    });
    await louezDb.db.insert(louezDb.reservationItems).values([
      {
        reservationId: id,
        productId: null,
        quantity: 1,
        unitPrice: "90.00",
        depositPerUnit: "0.00",
        totalPrice: "90.00",
        taxRate: "20.00",
        productSnapshot: { name: "Bike", description: null, images: [] },
      },
      {
        reservationId: id,
        productId: null,
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        productSnapshot: { name: "Insurance", description: null, images: [] },
      },
    ]);
    return id;
  }

  const options = { toolCallId: "call", messages: [] };
  type Input<K extends keyof Tools> = Parameters<NonNullable<Tools[K]["execute"]>>[0];

  async function recordPayment(input: Input<"record_payment">) {
    const execute = tools.record_payment.execute;
    assert.ok(execute, "the tool runs on the server");
    return execute(input, options);
  }

  async function deletePayment(input: Input<"delete_payment">) {
    const execute = tools.delete_payment.execute;
    assert.ok(execute, "the tool runs on the server");
    return execute(input, options);
  }

  async function returnDeposit(input: Input<"return_deposit">) {
    const execute = tools.return_deposit.execute;
    assert.ok(execute, "the tool runs on the server");
    return execute(input, options);
  }

  async function paymentsOf(reservationId: string) {
    return louezDb.db
      .select({
        id: louezDb.payments.id,
        type: louezDb.payments.type,
        amount: louezDb.payments.amount,
        currency: louezDb.payments.currency,
        grossMinor: louezDb.payments.grossMinor,
        insuranceShareMinor: louezDb.payments.insuranceShareMinor,
        origin: louezDb.payments.origin,
        status: louezDb.payments.status,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId))
      .orderBy(louezDb.payments.type);
  }

  async function queue() {
    const { billingSyncQueue: queueTable } = louezDb;
    return louezDb.db
      .select({
        type: queueTable.aggregateType,
        id: queueTable.aggregateId,
        storeId: queueTable.storeId,
        version: queueTable.version,
      })
      .from(queueTable)
      .orderBy(queueTable.aggregateType, queueTable.aggregateId);
  }

  test("record_payment writes the billing facts and marks the reservation", async () => {
    const reservationId = await createReservation();

    const output = await recordPayment({
      reservationId,
      type: "rental",
      amount: "50.00",
      method: "cash",
    });

    assert.deepEqual(output, {
      success: true,
      reservationNumber: reservationId,
      type: "rental",
      amount: "50.00",
      method: "cash",
    });
    const [payment] = await paymentsOf(reservationId);
    assert.deepEqual(
      { ...payment, id: undefined },
      {
        id: undefined,
        type: "rental",
        amount: "50.00",
        currency: "USD",
        grossMinor: 5000,
        // Half the total, so half the insurance (fees.md §4).
        insuranceShareMinor: 500,
        origin: "manual",
        status: "completed",
      },
    );
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 1 },
    ]);
  });

  test("a deposit return is a deposit-origin payment with no insurance share", async () => {
    const reservationId = await createReservation();
    await recordPayment({
      reservationId,
      type: "deposit",
      amount: "30.00",
      method: "card",
    });

    await returnDeposit({ reservationId, amount: "20.00", method: "card" });

    assert.deepEqual(
      (await paymentsOf(reservationId)).map(
        ({ type, grossMinor, insuranceShareMinor, origin }) => ({
          type,
          grossMinor,
          insuranceShareMinor,
          origin,
        }),
      ),
      [
        { type: "deposit", grossMinor: 3000, insuranceShareMinor: 0, origin: "manual" },
        { type: "deposit_return", grossMinor: 2000, insuranceShareMinor: 0, origin: "deposit" },
      ],
    );
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 2 },
    ]);
  });

  test("delete_payment marks the reservation", async () => {
    const reservationId = await createReservation();
    await recordPayment({
      reservationId,
      type: "adjustment",
      amount: "-5.00",
      method: "other",
    });
    const [payment] = await paymentsOf(reservationId);
    assert.equal(payment?.grossMinor, -500);

    await deletePayment({ paymentId: payment?.id ?? "" });

    assert.deepEqual(await paymentsOf(reservationId), []);
    assert.deepEqual(await queue(), [
      { type: "reservation", id: reservationId, storeId: STORE, version: 2 },
    ]);
  });

  test("without the billing service the payment is written and nothing is queued", async () => {
    const reservationId = await createReservation();
    delete process.env.BILLING_SERVICE_URL;
    try {
      await recordPayment({
        reservationId,
        type: "rental",
        amount: "10.00",
        method: "cash",
      });
    } finally {
      process.env.BILLING_SERVICE_URL = "http://localhost:3100";
    }

    assert.equal((await paymentsOf(reservationId)).length, 1);
    assert.deepEqual(await queue(), []);
  });
});

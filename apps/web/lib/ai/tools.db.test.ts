import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { AIChatContext, createAITools } from "./tools";

// The assistant's payment tools on a migrated database: they call the payment
// procedures as the signed-in user, which write through the dashboard's writer:
// each write carries its billing facts and marks the reservation for the billing
// service in the same transaction (louez-billing docs/api, README §5.2, Q3, Q4,
// Q7).

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
const directory = mkdtempSync(join(tmpdir(), "louez-ai-payments-"));
const authStubPath = join(directory, "auth.mjs");
writeFileSync(
  authStubPath,
  `export const auth = {};
export const mcpOAuth = null;
export const authInstance = {
  api: {
    getSession: async ({ headers }) => {
      const id = headers.get(${JSON.stringify(SESSION_HEADER)});
      return id ? { user: { id, email: id + "@ai.test" } } : null;
    },
  },
};`,
);
after(() => rmSync(directory, { recursive: true }));

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
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    if (specifier === "@louez/auth") {
      return { url: pathToFileURL(authStubPath).href, shortCircuit: true };
    }
    return next(specifier, context);
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
type AssistantApi = NonNullable<AIChatContext["api"]>;

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
    const { paymentRecordsPort } = await import("@/lib/api/payment-records-port");
    // packages/api is ES modules: its router needs the CommonJS packages'
    // names by hand. Loaded last, as the mocks change how later modules load.
    await import("@louez/mcp/testing/cjs-named-exports");
    const { appRouter } = await import("@louez/api/router");
    const { STORE_HEADER } = await import("@louez/api/platform/procedures");
    const { createRouterClient } = await import("@orpc/server");

    // The procedures as the chat route builds them: this user's session, on this store.
    const context = {
      headers: new Headers({ [SESSION_HEADER]: USER, [STORE_HEADER]: STORE }),
      transport: "rpc" as const,
      ports: {
        planFeatures: async () => ({ apiAccess: true }),
        runReservationEffects: async () => {},
        insurance: { createContract: async () => null, cancelContract: async () => {} },
        newStores: createTestNewStores(),
        dispatchEffects: () => {},
        storage: createMemoryStorage(),
        urls: createTestUrls(),
        afterCommit: () => {},
        paymentRecords: paymentRecordsPort,
      },
    };
    const at = (name: string) => ({ context, path: ["dashboard", name] });
    const { dashboard } = appRouter;
    const api: AssistantApi = {
      analytics: createRouterClient(dashboard.analytics, at("analytics")),
      categories: createRouterClient(dashboard.categories, at("categories")),
      payments: createRouterClient(dashboard.payments, at("payments")),
      products: createRouterClient(dashboard.products, at("products")),
      reservations: createRouterClient(dashboard.reservations, at("reservations")),
      settings: createRouterClient(dashboard.settings, at("settings")),
    };
    tools = aiTools.createAITools({
      storeId: STORE,
      userId: USER,
      storeName: "AI payments",
      urls: createTestUrls(),
      api,
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

    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "owner@ai.test" });
    // The store prices in EUR; the reservation froze USD at creation (contract Q4).
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: USER,
      name: "AI payments",
      slug: "ai-payments",
      settings: SETTINGS,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: USER, role: "owner" });
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

  test("the payment tools write no history line, and each call is recorded as the user's session", async () => {
    await louezDb.db.delete(louezDb.apiOperations).where(eq(louezDb.apiOperations.storeId, STORE));
    const reservationId = await createReservation();
    await recordPayment({ reservationId, type: "deposit", amount: "30.00", method: "card" });
    await returnDeposit({ reservationId, amount: "10.00", method: "card" });
    const [deposit] = (await paymentsOf(reservationId)).filter((row) => row.type === "deposit");
    await deletePayment({ paymentId: deposit?.id ?? "" });

    assert.deepEqual(
      await louezDb.db
        .select({ type: louezDb.reservationActivity.activityType })
        .from(louezDb.reservationActivity)
        .where(eq(louezDb.reservationActivity.reservationId, reservationId)),
      [],
    );
    assert.deepEqual(
      (
        await louezDb.db
          .select({
            procedure: louezDb.apiOperations.procedure,
            credentialKind: louezDb.apiOperations.credentialKind,
            userId: louezDb.apiOperations.userId,
            status: louezDb.apiOperations.status,
          })
          .from(louezDb.apiOperations)
          .where(eq(louezDb.apiOperations.storeId, STORE))
      )
        .map((row) => `${row.procedure} ${row.credentialKind} ${row.userId} ${row.status}`)
        .sort(),
      [
        `dashboard.payments.delete session ${USER} succeeded`,
        `dashboard.payments.record session ${USER} succeeded`,
        `dashboard.payments.recordDepositReturn session ${USER} succeeded`,
      ],
    );
  });

  test("the payment and deposit answers", async () => {
    const reservationId = await createReservation();
    await recordPayment({ reservationId, type: "deposit", amount: "30.00", method: "card" });

    assert.deepEqual(await returnDeposit({ reservationId, amount: "10.00", method: "cash" }), {
      success: true,
      reservationNumber: reservationId,
      amount: "10.00",
      method: "cash",
    });
    const [deposit] = (await paymentsOf(reservationId)).filter((row) => row.type === "deposit");
    assert.deepEqual(await deletePayment({ paymentId: deposit?.id ?? "" }), {
      success: true,
      reservationNumber: reservationId,
    });
  });

  test("each refusal answers with its message and writes nothing", async () => {
    const reservationId = await createReservation();
    await recordPayment({ reservationId, type: "deposit", amount: "30.00", method: "card" });
    await returnDeposit({ reservationId, amount: "10.00", method: "card" });
    const cancelled = await createReservation();
    await louezDb.db
      .update(louezDb.reservations)
      .set({ status: "cancelled" })
      .where(eq(louezDb.reservations.id, cancelled));
    const [charged] = await louezDb.db
      .insert(louezDb.payments)
      .values({
        reservationId,
        amount: "20.00",
        type: "rental",
        method: "stripe",
        status: "completed",
      })
      .$returningId();
    const before = await paymentsOf(reservationId);
    await louezDb.db.delete(louezDb.billingSyncQueue);

    assert.deepEqual(
      await recordPayment({ reservationId, type: "rental", amount: "0", method: "cash" }),
      { error: "Amount must be a non-zero number" },
    );
    assert.deepEqual(
      await recordPayment({ reservationId, type: "rental", amount: "abc", method: "cash" }),
      { error: "Amount must be a non-zero number" },
    );
    assert.deepEqual(
      await recordPayment({
        reservationId: cancelled,
        type: "rental",
        amount: "5.00",
        method: "cash",
      }),
      { error: "Cannot record payment on a cancelled reservation" },
    );
    assert.deepEqual(
      await recordPayment({
        reservationId: "res_nowhere",
        type: "rental",
        amount: "5.00",
        method: "cash",
      }),
      { error: "Reservation not found" },
    );
    assert.deepEqual(await returnDeposit({ reservationId, amount: "0", method: "cash" }), {
      error: "Amount must be greater than zero",
    });
    assert.deepEqual(await returnDeposit({ reservationId, amount: "20.01", method: "cash" }), {
      error:
        "Amount exceeds returnable deposit. Collected: 30.00, already returned: 10.00, max returnable: 20.00",
    });
    assert.deepEqual(
      await returnDeposit({ reservationId: "res_nowhere", amount: "1.00", method: "cash" }),
      { error: "Reservation not found" },
    );
    assert.deepEqual(await deletePayment({ paymentId: charged?.id ?? "" }), {
      error: "Cannot delete a Stripe payment. Use the Stripe dashboard for refunds.",
    });
    assert.deepEqual(await deletePayment({ paymentId: "pay_nowhere" }), {
      error: "Payment not found",
    });

    assert.deepEqual(await paymentsOf(reservationId), before);
    assert.deepEqual(await paymentsOf(cancelled), []);
    assert.deepEqual(await queue(), []);
  });

  test("record_payment refuses a negative amount outside an adjustment", async () => {
    // As the MCP tool does: the one change a user of the chat can see.
    const reservationId = await createReservation();
    assert.deepEqual(
      await recordPayment({ reservationId, type: "rental", amount: "-5.00", method: "cash" }),
      { error: 'Only "adjustment" payments can have a negative amount' },
    );
    assert.deepEqual(await paymentsOf(reservationId), []);
  });

  test("a user who only reads payments may not write them", async () => {
    const reservationId = await createReservation();
    const aiTools = await import("./tools");
    const reading = aiTools.createAITools({
      storeId: STORE,
      userId: USER,
      storeName: "AI payments",
      urls: createTestUrls(),
      permissions: {
        reservations: "read",
        products: "read",
        customers: "read",
        categories: "read",
        payments: "read",
        analytics: "read",
        settings: "read",
      },
    });
    const denied = /Permission denied: requires payments:write \(current: read\)/;
    await assert.rejects(
      async () =>
        reading.record_payment.execute?.(
          { reservationId, type: "rental", amount: "5.00", method: "cash" },
          options,
        ),
      denied,
    );
    await assert.rejects(
      async () =>
        reading.return_deposit.execute?.(
          { reservationId, amount: "5.00", method: "cash" },
          options,
        ),
      denied,
    );
    await assert.rejects(
      async () => reading.delete_payment.execute?.({ paymentId: "pay_any" }, options),
      denied,
    );
    assert.deepEqual(await paymentsOf(reservationId), []);
  });
  test("a customer's reservation history, ids and links show only to a user who may read reservations", async () => {
    // A reservation of the customer, for its history.
    const reservationId = await createReservation();
    await louezDb.db
      .insert(louezDb.customers)
      .values({
        id: "customer",
        storeId: STORE,
        email: "linked@ai.test",
        firstName: "Lea",
        lastName: "Link",
      })
      .onDuplicateKeyUpdate({ set: { firstName: "Lea" } });
    const aiTools = await import("./tools");
    const toolsWith = (permissions: Partial<Record<string, "none" | "read" | "write">>) =>
      aiTools.createAITools({
        storeId: STORE,
        userId: USER,
        storeName: "AI payments",
        urls: createTestUrls(),
        permissions: {
          reservations: "read",
          products: "read",
          customers: "read",
          categories: "read",
          payments: "read",
          analytics: "read",
          settings: "read",
          ...permissions,
        },
      });
    const customerOf = async (scoped: Tools) => {
      const output = await scoped.get_customer.execute?.({ customerId: "customer" }, options);
      assert.ok(output && "customer" in output, JSON.stringify(output));
      return JSON.stringify(output);
    };

    const blind = await customerOf(toolsWith({ reservations: "none" }));
    assert.ok(blind.includes(`/dashboard/customers/customer?store=${STORE}`), blind);
    assert.ok(!blind.includes(reservationId), blind);
    assert.ok(!blind.includes("/dashboard/reservations/"), blind);
    // Only the fields the tool picks: nothing of the store's row.
    assert.ok(!blind.includes('"storeId"'), blind);

    const seeing = await customerOf(toolsWith({}));
    assert.ok(seeing.includes(`/dashboard/reservations/${reservationId}?store=${STORE}`), seeing);
  });
});

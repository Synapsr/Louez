import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { McpSessionContext } from "../auth/context";
import type { McpRecordedPayment } from "./payments";

// The MCP payment tools on a migrated database. Recording goes through the app's
// writer (the dashboard's, which adds the billing facts), inside the tool's
// transaction; a deletion marks the reservation for the billing service itself
// (louez-billing docs/api, README §5.2).

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_mcp_payments";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "CHF",
} as const;

const ctx: McpSessionContext = {
  storeId: STORE,
  userId: "user_mcp_payments",
  storeName: "MCP payments",
  apiKeyId: "key_mcp_payments",
  permissions: {
    reservations: "read",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "write",
    analytics: "read",
    settings: "read",
  },
};

describe("MCP payment tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let client: Client;
  let recorded: McpRecordedPayment[] = [];
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("mcp_payments");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    const { registerPaymentTools } = await import("./payments");

    const server = new McpServer({ name: "louez", version: "0.0.0" });
    registerPaymentTools(server, ctx, {
      // A stand-in for the app's writer: it notes the payment and writes the row
      // with the tool's transaction, so a rollback would take both.
      insertRecordedPayment: async (tx, payment) => {
        recorded.push(payment);
        await tx.insert(louezDb.payments).values({
          reservationId: payment.reservationId,
          amount: payment.amount,
          type: payment.type,
          method: payment.method,
          status: "completed",
          origin: payment.origin,
          paidAt: payment.paidAt,
        });
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: ctx.userId,
      name: "MCP payments",
      slug: "mcp-payments",
      settings: SETTINGS,
    });
  });

  after(async () => {
    await client?.close();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    recorded = [];
    await louezDb.db.delete(louezDb.billingSyncQueue);
  });

  async function createReservation(): Promise<string> {
    const id = `res_mcp_pay_${++counter}`;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "confirmed",
      startDate: new Date("2027-03-01T09:00:00Z"),
      endDate: new Date("2027-03-03T09:00:00Z"),
      subtotalAmount: "80.00",
      depositAmount: "50.00",
      totalAmount: "80.00",
    });
    return id;
  }

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
  }

  const withoutDate = ({ paidAt, ...payment }: McpRecordedPayment) => {
    assert.ok(paidAt instanceof Date);
    return payment;
  };

  async function reservationMarks() {
    const { billingSyncQueue: queueTable } = louezDb;
    return louezDb.db
      .select({
        id: queueTable.aggregateId,
        storeId: queueTable.storeId,
        version: queueTable.version,
      })
      .from(queueTable)
      .where(eq(queueTable.aggregateType, "reservation"));
  }

  test("record_payment hands the payment and the store's settings to the app's writer", async () => {
    const reservationId = await createReservation();

    await call("record_payment", {
      reservationId,
      type: "rental",
      amount: "80.00",
      method: "transfer",
      notes: "Paid by wire",
    });

    assert.deepEqual(recorded.map(withoutDate), [
      {
        reservationId,
        storeId: STORE,
        storeSettings: SETTINGS,
        type: "rental",
        method: "transfer",
        amount: "80.00",
        origin: "manual",
        notes: "Paid by wire",
      },
    ]);
  });

  test("return_deposit records a deposit-origin return", async () => {
    const reservationId = await createReservation();
    await call("record_payment", {
      reservationId,
      type: "deposit",
      amount: "50.00",
      method: "cash",
    });

    await call("return_deposit", { reservationId, amount: "50.00", method: "cash" });

    assert.deepEqual(
      recorded.map(({ type, origin, amount }) => ({ type, origin, amount })),
      [
        { type: "deposit", origin: "manual", amount: "50.00" },
        { type: "deposit_return", origin: "deposit", amount: "50.00" },
      ],
    );
  });

  test("delete_payment deletes the row and marks the reservation", async () => {
    const reservationId = await createReservation();
    await call("record_payment", {
      reservationId,
      type: "damage",
      amount: "15.00",
      method: "card",
    });
    const [payment] = await louezDb.db
      .select({ id: louezDb.payments.id })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    assert.ok(payment);

    await call("delete_payment", { paymentId: payment.id });

    const left = await louezDb.db
      .select({ id: louezDb.payments.id })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    assert.deepEqual(left, []);
    assert.deepEqual(await reservationMarks(), [{ id: reservationId, storeId: STORE, version: 1 }]);
  });
});

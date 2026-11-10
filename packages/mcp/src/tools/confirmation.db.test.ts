import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { McpRecordedPayment } from "./payments";

// The hand-written tools that move money, delete or send to a customer ask for
// a confirmation first, as sensitive procedures do, when the connection wants
// one: the first call does nothing and answers CONFIRMATION_REQUIRED with a
// preview and a token; the same call with the token runs once. The money tools
// (record_payment, delete_payment, return_deposit) ask even a connection whose
// confirmations are off.

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_mcp_confirm";
const USER = "user_mcp_confirm";
const permissions = {
  reservations: "write",
  products: "write",
  customers: "read",
  categories: "read",
  payments: "write",
  analytics: "read",
  settings: "read",
} as const;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

describe(
  "confirmation of the sensitive hand-written tools (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let confirming: Client;
    let direct: Client;
    let recorded: McpRecordedPayment[] = [];
    let counter = 0;

    async function connect(confirmSensitive: boolean) {
      const { registerPaymentTools } = await import("./payments");
      const { testRequestContext } = await import("../testing/request-context");
      const ctx = testRequestContext({
        storeId: STORE,
        userId: USER,
        apiKeyId: confirmSensitive ? "key_confirming" : "key_direct",
        permissions,
        confirmSensitive,
      });
      const server = new McpServer({ name: "louez", version: "0.0.0" });
      registerPaymentTools(server, ctx, {
        insertRecordedPayment: async (_tx, payment) => {
          recorded.push(payment);
        },
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(clientTransport);
      return client;
    }

    before(async () => {
      database = await createTestDatabase("mcp_confirm");
      louezDb = await import("@louez/db");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Confirm store",
        slug: "mcp-confirm",
      });
      confirming = await connect(true);
      direct = await connect(false);
    });

    after(async () => {
      await confirming?.close();
      await direct?.close();
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      recorded = [];
    });

    async function reservation(status: "pending" | "confirmed" = "pending") {
      const id = `res_mcp_confirm_${++counter}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer",
        number: id,
        status,
        startDate: new Date("2027-03-01T09:00:00Z"),
        endDate: new Date("2027-03-03T09:00:00Z"),
        subtotalAmount: "80.00",
        depositAmount: "50.00",
        totalAmount: "80.00",
      });
      return id;
    }

    const error = (result: ToolResult) =>
      (
        result.structuredContent as
          | { error?: { code?: string; details?: { confirmationToken?: string } } }
          | undefined
      )?.error;

    function confirmationToken(result: ToolResult): string {
      assert.equal(result.isError, true, JSON.stringify(result.content));
      assert.equal(error(result)?.code, "CONFIRMATION_REQUIRED");
      const token = error(result)?.details?.confirmationToken;
      assert.ok(token);
      return token;
    }

    test("a payment waits for the confirmation, then runs once", async () => {
      const id = await reservation();
      const args = { reservationId: id, type: "rental", amount: "80.00", method: "cash" };

      const first = await confirming.callTool({ name: "record_payment", arguments: args });
      const token = confirmationToken(first);
      assert.match(JSON.stringify(first.content), new RegExp(`#${id}`), "the preview names it");
      assert.equal(recorded.length, 0, "nothing was done yet");

      const second = await confirming.callTool({
        name: "record_payment",
        arguments: { ...args, confirmationToken: token },
      });
      assert.notEqual(second.isError, true, JSON.stringify(second.content));
      assert.equal(recorded.length, 1);

      const replay = await confirming.callTool({
        name: "record_payment",
        arguments: { ...args, confirmationToken: token },
      });
      assert.equal(error(replay)?.code, "CONFIRMATION_INVALID", "a token works once");
      assert.equal(recorded.length, 1);
    });

    test("a token stops working once the state it previewed changes", async () => {
      const id = await reservation();
      const args = { reservationId: id, type: "rental", amount: "80.00", method: "cash" };
      const token = confirmationToken(
        await confirming.callTool({ name: "record_payment", arguments: args }),
      );
      assert.equal(recorded.length, 0);

      await louezDb.db
        .update(louezDb.reservations)
        .set({ status: "confirmed" })
        .where(eq(louezDb.reservations.id, id));
      const late = await confirming.callTool({
        name: "record_payment",
        arguments: { ...args, confirmationToken: token },
      });
      assert.equal(error(late)?.code, "CONFIRMATION_INVALID");
      assert.equal(recorded.length, 0);

      // Another argument than the previewed one: refused too.
      const fresh = confirmationToken(
        await confirming.callTool({ name: "record_payment", arguments: args }),
      );
      const changed = await confirming.callTool({
        name: "record_payment",
        arguments: { ...args, amount: "800.00", confirmationToken: fresh },
      });
      assert.equal(error(changed)?.code, "CONFIRMATION_INVALID");
      assert.equal(recorded.length, 0);
    });

    test("deleting a payment waits for the confirmation", async () => {
      const id = await reservation("confirmed");
      const [payment] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId: id,
          amount: "20.00",
          type: "rental",
          method: "cash",
          status: "completed",
        })
        .$returningId();
      confirmationToken(
        await confirming.callTool({ name: "delete_payment", arguments: { paymentId: payment.id } }),
      );
      const kept = await louezDb.db.query.payments.findFirst({
        where: eq(louezDb.payments.id, payment.id),
      });
      assert.ok(kept, "the payment is still there");
    });

    test("a connection with confirmation off is still asked before any money tool", async () => {
      const id = await reservation("confirmed");
      const [deposit] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId: id,
          amount: "50.00",
          type: "deposit",
          method: "cash",
          status: "completed",
        })
        .$returningId();
      const calls = [
        {
          name: "record_payment",
          arguments: { reservationId: id, type: "rental", amount: "80.00", method: "cash" },
        },
        {
          name: "return_deposit",
          arguments: { reservationId: id, amount: "50.00", method: "cash" },
        },
        { name: "delete_payment", arguments: { paymentId: deposit.id } },
      ];
      for (const call of calls) {
        const before = recorded.length;
        const token = confirmationToken(await direct.callTool(call));
        assert.equal(recorded.length, before, `${call.name} did nothing yet`);
        const done = await direct.callTool({
          ...call,
          arguments: { ...call.arguments, confirmationToken: token },
        });
        assert.notEqual(done.isError, true, JSON.stringify(done.content));
      }
      assert.deepEqual(
        recorded.map((payment) => payment.type),
        ["rental", "deposit_return"],
      );
      const deleted = await louezDb.db.query.payments.findFirst({
        where: eq(louezDb.payments.id, deposit.id),
      });
      assert.equal(deleted, undefined, "the confirmed deletion ran");
    });

    test("a record the preview cannot find goes to the tool, which answers for it", async () => {
      // No preview to show: the tool gets the call and answers "not found" for
      // a reservation outside the store; nothing is asked to be confirmed.
      const missing = await confirming.callTool({
        name: "record_payment",
        arguments: {
          reservationId: "res_nowhere",
          type: "rental",
          amount: "80.00",
          method: "cash",
        },
      });
      assert.notEqual(error(missing)?.code, "CONFIRMATION_REQUIRED");
      assert.match(JSON.stringify(missing.content), /not found/);
      assert.equal(recorded.length, 0);
    });
  },
);

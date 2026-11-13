import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { McpRecordedPayment } from "./payments";

// Who the hand-written money tools ask today, by kind of credential and the
// connection's option: an API key and an assistant's connection (OAuth),
// option on or off, are asked before each of record_payment,
// record_deposit_return and delete_payment, and the token lets the call run
// once; a dashboard session (as the in-memory context can make one) runs
// directly. The API key's cases are also in confirmation.db.test.ts; this
// table adds the other credentials.

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_mcp_conf_cred";
const USER = "user_mcp_conf_cred";
const permissions = {
  reservations: "write",
  products: "write",
  customers: "read",
  categories: "read",
  payments: "write",
  analytics: "read",
  settings: "read",
} as const;

type Kind = "session" | "api_key" | "oauth";
type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

const CASES: Array<{ kind: Kind; confirmSensitive: boolean; asked: boolean }> = [
  { kind: "session", confirmSensitive: false, asked: false },
  { kind: "api_key", confirmSensitive: true, asked: true },
  { kind: "api_key", confirmSensitive: false, asked: true },
  { kind: "oauth", confirmSensitive: true, asked: true },
  { kind: "oauth", confirmSensitive: false, asked: true },
];

describe(
  "who the hand-written money tools ask, by credential (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let recorded: McpRecordedPayment[] = [];
    let counter = 0;
    const clients: Client[] = [];

    async function connect(kind: Kind, confirmSensitive: boolean) {
      const { registerPaymentTools } = await import("./payments");
      const { testRequestContext } = await import("../testing/request-context");
      const ctx = testRequestContext({
        storeId: STORE,
        userId: USER,
        apiKeyId: `cred_${kind}_${confirmSensitive ? "on" : "off"}`,
        permissions,
        confirmSensitive,
      });
      const { credential } = ctx.actor;
      ctx.actor.credential = {
        ...credential,
        kind,
        id: kind === "session" ? null : credential.id,
        scopes: kind === "session" ? null : credential.scopes,
      };
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
      clients.push(client);
      return client;
    }

    before(async () => {
      database = await createTestDatabase("mcp_confirm_credentials");
      louezDb = await import("@louez/db");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Credentials store",
        slug: "mcp-confirm-credentials",
      });
    });

    after(async () => {
      for (const client of clients) await client.close();
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    async function reservationWithDeposit() {
      const id = `res_mcp_cred_${++counter}`;
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
      return { id, depositId: deposit.id };
    }

    const error = (result: ToolResult) =>
      (
        result.structuredContent as
          | {
              error?: {
                code?: string;
                details?: { confirmationToken?: string; preview?: { summary?: string } };
              };
            }
          | undefined
      )?.error;

    for (const { kind, confirmSensitive, asked } of CASES) {
      test(`${kind}, option ${confirmSensitive ? "on" : "off"}: ${asked ? "asked" : "runs directly"}`, async () => {
        const client = await connect(kind, confirmSensitive);
        const { id, depositId } = await reservationWithDeposit();
        const calls = [
          {
            name: "record_payment",
            arguments: { reservationId: id, type: "rental", amount: "80.00", method: "cash" },
            replay: "CONFIRMATION_INVALID",
          },
          {
            name: "record_deposit_return",
            arguments: { reservationId: id, amount: "50.00", method: "cash" },
            replay: "CONFIRMATION_INVALID",
          },
          // Once deleted, there is no payment left to preview: the tool answers.
          { name: "delete_payment", arguments: { paymentId: depositId }, replay: "NOT_FOUND" },
        ];
        for (const { replay, ...call } of calls) {
          const before = recorded.length;
          const first = await client.callTool(call);
          if (!asked) {
            assert.notEqual(first.isError, true, `${call.name}: ${JSON.stringify(first.content)}`);
            continue;
          }
          assert.equal(first.isError, true, `${call.name} is asked`);
          assert.equal(error(first)?.code, "CONFIRMATION_REQUIRED", call.name);
          assert.ok(error(first)?.details?.preview?.summary, `${call.name} shows a preview`);
          const token = error(first)?.details?.confirmationToken;
          assert.ok(token, `${call.name} gives a token`);
          assert.equal(recorded.length, before, `${call.name} did nothing yet`);

          const confirmed = { ...call, arguments: { ...call.arguments, confirmationToken: token } };
          const done = await client.callTool(confirmed);
          assert.notEqual(done.isError, true, `${call.name}: ${JSON.stringify(done.content)}`);
          const again = await client.callTool(confirmed);
          assert.equal(error(again)?.code, replay, `${call.name}: a token works once`);
        }
      });
    }
  },
);

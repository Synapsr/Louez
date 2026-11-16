import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import type {
  RecordedPayment,
  RecordedPaymentDraft,
  RecordedRefund,
} from "@louez/api/platform/ports";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// Who the four payment writes ask, by kind of credential and the
// connection's option: an API key and an assistant's connection (OAuth),
// option on or off, need the user's approval before each of record_payment,
// record_deposit_return, record_refund and delete_payment, through the real
// MCP handler, and
// the approval, once the user approved it, lets the call run once; a
// dashboard session, through the
// dashboard's RPC handler, runs directly. Each call declares money, the
// deletion included, as the rule receives it. The procedures' other facts
// (previews, bindings, refusals, the REST API) are in payments.db.test.ts.

// A dashboard session, read from a test header; OAuth access tokens signed
// with a test key and checked by the real verifier. Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
const CLIENT = "https://claude.cc.test/oauth/client.json";

let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@cc.test` } } : null;
        },
      },
    },
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "cc_store_a_000000001";
const USER = "cc_owner_user_000001";
const CUSTOMER = "cc_customer_00000001";

type Kind = "session" | "api_key" | "oauth";
type Json = Record<string, unknown>;

/** A call's answer, whatever the transport: its error's code and details, or none. */
interface Answer {
  error?: {
    code?: string;
    details?: {
      confirmationToken?: string;
      preview?: { summary?: string };
      approval?: { id?: string };
      reason?: string;
    };
  };
}

const CASES: Array<{ kind: Kind; confirmSensitive: boolean; asked: boolean }> = [
  { kind: "session", confirmSensitive: false, asked: false },
  { kind: "api_key", confirmSensitive: true, asked: true },
  { kind: "api_key", confirmSensitive: false, asked: true },
  { kind: "oauth", confirmSensitive: true, asked: true },
  { kind: "oauth", confirmSensitive: false, asked: true },
];

/** The RPC name of each tool's procedure, under `dashboard.payments`. */
const RPC_NAME: Record<string, string> = {
  record_payment: "record",
  record_deposit_return: "recordDepositReturn",
  record_refund: "recordRefund",
  delete_payment: "delete",
};

describe(
  "who the payment writes ask, by credential (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("@louez/api/services");
    let grants: typeof import("@louez/api/services/agent-grants");
    let handleMcpRequest: typeof import("./transports/http").handleMcpRequest;
    let httpOptions: import("./transports/http").McpHttpOptions;
    let rpc: (name: string, input: Json) => Promise<unknown>;
    /** The owner's answer on an approval's page, with their session. */
    let decide: (input: Json) => Promise<unknown>;
    let recorded: Array<RecordedPayment | RecordedRefund> = [];
    let counter = 0;
    /** The consequences each confirmation handed the rule, in order. */
    let emitted: unknown[] = [];

    /** A stand-in for the app's billing facts: the reservation's currency, else the store's; no gross, no share. */
    const recordedFacts = async (
      tx: import("@louez/db").Transaction,
      draft: RecordedPaymentDraft,
    ) => {
      const [row] = await tx
        .select({ currency: louezDb.reservations.currency })
        .from(louezDb.reservations)
        .where(orm.eq(louezDb.reservations.id, draft.reservationId));
      return {
        currency: row?.currency ?? draft.storeSettings?.currency ?? "EUR",
        grossMinor: null,
        insuranceShareMinor: 0,
      };
    };

    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: () => {},
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: () => {},
      // The app's writer, as a stand-in: it notes the payment and writes its row.
      paymentRecords: {
        facts: recordedFacts,
        insert: async (tx: import("@louez/db").Transaction, payment: RecordedPayment) => {
          recorded.push(payment);
          await tx.insert(louezDb.payments).values({
            reservationId: payment.reservationId,
            amount: payment.amount,
            type: payment.type,
            method: payment.method,
            status: "completed",
            origin: payment.origin,
          });
        },
      },
      // The app's refund writer, as a stand-in: it notes the refund and writes its row.
      paymentRefunds: {
        insert: async (tx: import("@louez/db").Transaction, refund: RecordedRefund) => {
          recorded.push(refund);
          const [row] = await tx
            .insert(louezDb.payments)
            .values({
              reservationId: refund.reservationId,
              amount: refund.amount,
              type: refund.type,
              method: refund.method,
              status: "completed",
              origin: "manual",
              currency: refund.currency,
              refundOfPaymentId: refund.paymentId,
            })
            .$returningId();
          return { id: String(row?.id) };
        },
        creditNote: async () => ({ status: "not_applicable" as const, reason: "invoicing_disabled" }),
      },
    };

    before(async () => {
      // The rule, as it is, with what each call declared kept; before any
      // module that asks loads it.
      const specifier = "@louez/api/platform/approval-rule";
      const rule: Record<string, unknown> = await import(specifier);
      const confirmationStep = rule.confirmationStep as (...args: unknown[]) => unknown;
      mock.module(import.meta.resolve(specifier), {
        namedExports: {
          ...rule,
          confirmationStep: (consequences: unknown[], credential: unknown) => {
            emitted.push([...consequences]);
            return confirmationStep(consequences, credential);
          },
        },
      });
      tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
      database = await createTestDatabase("mcp_confirm_credentials");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      apiKeys = await import("@louez/api/services");
      grants = await import("@louez/api/services/agent-grants");
      const { appRouter } = await import("@louez/api/router");
      const { createExposure } = await import("@louez/api/platform/exposure");
      ({ handleMcpRequest } = await import("./transports/http"));
      httpOptions = { ports, procedures: createExposure(appRouter).procedures };

      // The dashboard's RPC handler, as /api/rpc serves it, with the owner's session.
      const { RPCHandler } = await import("@orpc/server/fetch");
      const { createORPCClient } = await import("@orpc/client");
      const { RPCLink } = await import("@orpc/client/fetch");
      const rpcHandler = new RPCHandler(appRouter);
      const client = createORPCClient<{
        dashboard: {
          payments: Record<string, (input: Json) => Promise<unknown>>;
          handoffs: { decide: (input: Json) => Promise<unknown> };
        };
      }>(
        new RPCLink({
          url: "http://louez.test/api/rpc",
          headers: { [SESSION_HEADER]: USER, "louez-store": STORE },
          fetch: async (request) => {
            const { response } = await rpcHandler.handle(request, {
              prefix: "/api/rpc",
              context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
            });
            return response ?? new Response(null, { status: 404 });
          },
        }),
      );
      rpc = (name, input) => client.dashboard.payments[name](input);
      decide = (input) => client.dashboard.handoffs.decide(input);

      await louezDb.db.insert(louezDb.users).values({ id: USER, email: "owner@cc.test" });
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Credentials store",
        slug: "cc-confirm-credentials",
      });
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE, userId: USER, role: "owner" });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@cc.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
      await louezDb.db.insert(louezDb.oauthClients).values({
        clientId: CLIENT,
        name: "Claude",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://claude.cc.test/callback"]),
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** The `authorization` of an API key or an OAuth connection with this option. */
    async function authorization(kind: "api_key" | "oauth", confirmSensitive: boolean) {
      if (kind === "api_key") {
        const created = await apiKeys.createApiKey({
          db: louezDb.db,
          storeId: STORE,
          userId: USER,
          name: `Payments agent ${confirmSensitive ? "on" : "off"}`,
          permissions: {
            reservations: "read",
            products: "read",
            customers: "read",
            categories: "read",
            payments: "write",
            analytics: "read",
            settings: "read",
          },
        });
        await louezDb.db
          .update(louezDb.apiKeys)
          .set({ confirmSensitive })
          .where(orm.eq(louezDb.apiKeys.id, created.id));
        return `Bearer ${created.key}`;
      }
      const grant = await grants.saveGrant({
        userId: USER,
        clientId: CLIENT,
        terms: {
          stores: { all: false, ids: [STORE] },
          preset: "write",
          confirmSensitive,
          bundles: ["daily"],
        },
      });
      return `Bearer ${await tokens.sign({ userId: USER, clientId: CLIENT, grantId: grant.id })}`;
    }

    /** Calls a tool through the real MCP handler; its answer as the bridge gives it. */
    async function mcpCall(auth: string, name: string, args: Json) {
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(RESOURCE), {
          requestInit: { headers: { authorization: auth, "louez-store": STORE } },
          fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
        }),
      );
      try {
        const result = await client.callTool({ name, arguments: args });
        return {
          isError: result.isError === true,
          error: (result.structuredContent as Answer | undefined)?.error,
          text: JSON.stringify(result.content),
        };
      } finally {
        await client.close();
      }
    }

    /** Calls the procedure through the dashboard's RPC handler, with the owner's session. */
    async function sessionCall(name: string, args: Json) {
      try {
        await rpc(RPC_NAME[name], args);
        return { isError: false, error: undefined, text: "" };
      } catch (error) {
        const data = (error as { data?: Answer["error"] }).data;
        return { isError: true, error: data, text: String(error) };
      }
    }

    /** A reservation with a deposit and a rental payment, both taken by hand. */
    async function reservationWithDeposit() {
      const id = `cc_res_${String(++counter).padStart(14, "0")}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
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
      const [rental] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId: id,
          amount: "80.00",
          type: "rental",
          method: "card",
          status: "completed",
        })
        .$returningId();
      return { id, depositId: deposit.id, rentalId: rental.id };
    }

    const typesOf = async (reservationId: string) =>
      (
        await louezDb.db
          .select({ type: louezDb.payments.type })
          .from(louezDb.payments)
          .where(orm.eq(louezDb.payments.reservationId, reservationId))
          .orderBy(louezDb.payments.type)
      ).map((row) => row.type);

    for (const { kind, confirmSensitive, asked } of CASES) {
      test(`${kind}, option ${confirmSensitive ? "on" : "off"}: ${asked ? "asked" : "runs directly"}`, async () => {
        const auth = kind === "session" ? null : await authorization(kind, confirmSensitive);
        const send = (name: string, args: Json) =>
          auth === null ? sessionCall(name, args) : mcpCall(auth, name, args);
        const { id, depositId, rentalId } = await reservationWithDeposit();
        const calls = [
          {
            name: "record_payment",
            arguments: { reservationId: id, type: "rental", amount: "80.00", method: "cash" },
            replay: "APPROVAL_INVALID",
          },
          // The whole deposit given back: the same return again exceeds the
          // balance, refused before anything is asked or any approval read.
          {
            name: "record_deposit_return",
            arguments: { reservationId: id, amount: "50.00", method: "cash" },
            replay: "DEPOSIT_RETURN_EXCEEDS_BALANCE",
          },
          // Part of the rental given back: the same refund again is still
          // within what is left, so the approval is what refuses it.
          {
            name: "record_refund",
            arguments: { paymentId: rentalId, amount: "30.00", method: "cash" },
            replay: "APPROVAL_INVALID",
          },
          // Once deleted, the payment is not found: refused before anything is asked.
          {
            name: "delete_payment",
            arguments: { paymentId: depositId },
            replay: "PAYMENT_NOT_FOUND",
          },
        ];
        for (const { replay, ...call } of calls) {
          const before = recorded.length;
          emitted = [];
          const first = await send(call.name, call.arguments);
          // Every caller reaches the rule, a session too: the rule says who is asked.
          assert.deepEqual(emitted, [["money"]], `${call.name} declares money`);
          if (!asked) {
            assert.equal(first.isError, false, `${call.name}: ${first.text}`);
            continue;
          }
          assert.equal(first.isError, true, `${call.name} is asked`);
          assert.equal(first.error?.code, "APPROVAL_REQUIRED", call.name);
          assert.ok(first.error?.details?.preview?.summary, `${call.name} shows a preview`);
          const token = first.error?.details?.approval?.id;
          assert.ok(token, `${call.name} gives an approval`);
          assert.equal(first.error?.details?.confirmationToken, token);
          assert.equal(recorded.length, before, `${call.name} did nothing yet`);

          // The user approves it on its page, signed in.
          const [row] = await louezDb.db
            .select()
            .from(louezDb.apiHandoffs)
            .where(orm.eq(louezDb.apiHandoffs.id, token));
          assert.ok(row);
          await decide({
            id: token,
            decision: "approve",
            revision: row.revision,
            shown: row.bindingHash,
            acknowledged: true,
          });

          const confirmed = { ...call.arguments, confirmationToken: token };
          emitted = [];
          const done = await send(call.name, confirmed);
          assert.equal(done.isError, false, `${call.name}: ${done.text}`);
          assert.deepEqual(emitted, [["money"]], `${call.name}: the approved call declares money`);
          const again = await send(call.name, confirmed);
          assert.equal(again.error?.code, replay, `${call.name}: an approval works once`);
          if (replay === "APPROVAL_INVALID") assert.equal(again.error?.details?.reason, "used");
        }
        // Each ran once: the payment, the return, the refund, and the deposit deleted.
        assert.deepEqual(await typesOf(id), ["rental", "rental", "rental", "deposit_return"]);
      });
    }
  },
);

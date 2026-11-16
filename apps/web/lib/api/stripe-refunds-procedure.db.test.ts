import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type {
  ProviderRefund,
  RefundAnswer,
  StripeRefundPort,
} from "@/lib/reservations/stripe-refund-stripe";
import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// An agent refunds a payment taken online (refund_payment, POST /payments/{id}/refunds),
// through the real MCP and OpenAPI handlers, with an API key, on a database, the key's
// owner approving through the dashboard's RPC handler, as the approval's page does. The
// app's own port runs (lib/api/stripe-refunds-port.ts) on the app's refund operation;
// only Stripe is a fake, and the network is closed.

// @louez/types, @louez/utils and @louez/validations are CommonJS under tsx: their
// names are handed to the loader, as packages/mcp's preload does.
const here = createRequire(import.meta.url);
const fromApi = createRequire(here.resolve("@louez/api/platform/actor"));
const apiDependencyUrl = (name: string) => pathToFileURL(fromApi.resolve(name)).href;
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  mock.module(apiDependencyUrl(name), { namedExports: fromApi(name) });
}
const SESSION_HEADER = "x-test-session-user";
const ASSISTANT_HEADER = "x-test-assistant";
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@srf.test` } } : null;
        },
      },
    },
  },
});
// The invoice PDF imports "server-only", which throws outside Next.
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
mock.module("@/lib/referral/rewards", {
  namedExports: { clawbackReferrerRewardForQualifyingPayment: async () => {} },
});

closeNetworkForSuite();

const OWNER = "srf_owner_user_00001";
const STORE = "srf_store_a_00000001";
const OTHER_STORE = "srf_store_b_00000001";
const CUSTOMER = "srf_customer_0000001";
const ACCOUNT = "acct_srf_procedure";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
} as const;

// The MCP client, as the MCP package resolves it: the app does not depend on it.
const mcpClientPath = createRequire(here.resolve("@louez/mcp/http")).resolve(
  "@modelcontextprotocol/client",
);
type Json = Record<string, unknown>;
/** What this suite reads of a tool's result. */
type ToolResult = {
  isError?: boolean;
  content: unknown;
  structuredContent?: unknown;
};
/** The client of the MCP SDK, as far as this suite uses it. */
type McpClientModule = {
  Client: new (info: { name: string; version: string }) => {
    connect(transport: unknown): Promise<void>;
    callTool(call: { name: string; arguments: Json }): Promise<ToolResult>;
    close(): Promise<void>;
  };
  StreamableHTTPClientTransport: new (
    url: URL,
    options: {
      requestInit: { headers: Record<string, string> };
      fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
    },
  ) => unknown;
};
const loadMcpClient = (): Promise<McpClientModule> =>
  import(pathToFileURL(mcpClientPath).href) as Promise<McpClientModule>;
type Behaviour = "ok" | "timeout_before" | "lost_after" | { refuse: string };

/** Stripe, as far as a refund goes, with its idempotency. */
function fakeStripe() {
  const charges = new Map<
    string,
    { currency: string; captured: number; refunds: ProviderRefund[] }
  >();
  const keys = new Map<string, string>();
  const creates: string[] = [];
  const behaviours: Behaviour[] = [];
  const failures = { list: 0 };
  let sequence = 0;
  const moved = (refunds: ProviderRefund[]) =>
    refunds.filter((r) => r.status !== "failed").reduce((sum, r) => sum + r.amount, 0);
  const port: StripeRefundPort = {
    async readCharge(_accountId, chargeId) {
      const charge = charges.get(chargeId);
      if (!charge) throw new Error(`No such charge: ${chargeId}`);
      return {
        chargeId,
        amountCapturedMinor: charge.captured,
        amountRefundedMinor: moved(charge.refunds),
        currency: charge.currency,
        card: { brand: "visa", last4: "4242" },
      };
    },
    async createRefund(request, key): Promise<RefundAnswer> {
      creates.push(key);
      const charge = charges.get(request.chargeId);
      if (!charge) throw new Error("no charge");
      const stored = keys.get(key);
      if (stored) {
        const refund = charge.refunds.find((r) => r.id === stored);
        if (refund) return { kind: "created", refund };
      }
      const behaviour = behaviours.shift() ?? "ok";
      if (behaviour === "timeout_before") {
        return { kind: "indeterminate", replayed: false, message: "timeout" };
      }
      if (typeof behaviour === "object") {
        return { kind: "refused", code: behaviour.refuse, message: `Refused: ${behaviour.refuse}` };
      }
      const refund: ProviderRefund = {
        id: `re_srf_${++sequence}`,
        amount: request.amountMinor,
        created: Math.floor(Date.now() / 1000),
        status: "succeeded",
        currency: charge.currency,
        failureReason: null,
        operationId: request.operationId,
      };
      charge.refunds.unshift(refund);
      keys.set(key, refund.id);
      if (behaviour === "lost_after") {
        return { kind: "indeterminate", replayed: false, message: "timeout" };
      }
      return { kind: "created", refund };
    },
    async listChargeRefunds({ chargeId }) {
      if (failures.list > 0) {
        failures.list--;
        throw new Error("Stripe could not be listed");
      }
      return { refunds: charges.get(chargeId)?.refunds ?? [], hasMore: false };
    },
  };
  return { port, charges, creates, behaviours, failures };
}

describe(
  "an agent refunds a payment taken online, through MCP and REST (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("@louez/api/services");
    let mcpCall: (authorization: string, name: string, args: object) => Promise<ToolResult>;
    let openApi: (
      method: string,
      path: string,
      body: object | null,
      headers: Record<string, string>,
    ) => Promise<Response>;
    let rpc: (
      user: string,
      path: string,
      input: object,
      headers?: Record<string, string>,
    ) => Promise<unknown>;
    const stripe = fakeStripe();
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("stripe_refund_procedure");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      apiKeys = await import("@louez/api/services");
      const { createStripeRefundsPort } = await import("./stripe-refunds-port");
      const { createStripeRefundEffectSenders } = await import("@/lib/reservations/stripe-refund");
      const deps = { database: louezDb.db, stripe: stripe.port, dispatchEffects: () => {} };
      const { createMemoryStorage } = await import("@louez/api/platform/memory-storage");
      const { createTestNewStores } = await import("@louez/api/platform/test-new-stores");
      const { createTestUrls } = await import("@louez/api/platform/test-urls");
      const ports = {
        planFeatures: async () => ({ apiAccess: true }),
        runReservationEffects: async () => {},
        insurance: { createContract: async () => null, cancelContract: async () => {} },
        newStores: createTestNewStores(),
        dispatchEffects: () => {},
        storage: createMemoryStorage(),
        urls: createTestUrls(),
        afterCommit: () => {},
        stripeRefunds: createStripeRefundsPort({
          ...deps,
          senders: async () =>
            createStripeRefundEffectSenders(
              deps,
            ) as unknown as import("@louez/api/platform/effects").ApiEffectSenders,
        }),
      };
      const { appRouter } = await import("@louez/api/router");
      const { createExposure } = await import("@louez/api/platform/exposure");
      const { handleMcpRequest } = await import("@louez/mcp/http");
      const { Client, StreamableHTTPClientTransport } = await loadMcpClient();
      const exposure = createExposure(appRouter);
      const { createApiReference, createOpenApiHandler, handleOpenApiRequest } =
        await import("@louez/api/platform/openapi");
      const openApiHandler = createOpenApiHandler(exposure.router);
      const reference = createApiReference(exposure.router);
      openApi = async (method, path, body, headers) =>
        (await handleOpenApiRequest(
          openApiHandler,
          new Request(
            `http://louez.test/api/v1${path}`,
            body
              ? {
                  method,
                  headers: { "content-type": "application/json", ...headers },
                  body: JSON.stringify(body),
                }
              : { method, headers },
          ),
          { ports, reference },
        )) ?? new Response(null, { status: 404 });
      const httpOptions = { ports, procedures: exposure.procedures };
      mcpCall = async (authorization, name, args) => {
        const mcp = new Client({ name: "test", version: "0.0.0" });
        await mcp.connect(
          new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
            requestInit: { headers: { authorization } },
            fetch: (url: string | URL, init?: RequestInit) =>
              handleMcpRequest(new Request(url, init), httpOptions),
          }),
        );
        try {
          return await mcp.callTool({ name, arguments: args as Json });
        } finally {
          await mcp.close();
        }
      };
      const { RPCHandler } = await import("@orpc/server/fetch");
      const { createORPCClient } = await import("@orpc/client");
      const { RPCLink } = await import("@orpc/client/fetch");
      const rpcHandler = new RPCHandler(appRouter);
      rpc = (user, path, input, extra = {}) => {
        const client = createORPCClient<
          Record<string, Record<string, Record<string, (input: object) => Promise<unknown>>>>
        >(
          new RPCLink({
            url: "http://louez.test/api/rpc",
            headers: { [SESSION_HEADER]: user, cookie: `louez_active_store=${STORE}`, ...extra },
            fetch: async (request) => {
              const { response } = await rpcHandler.handle(request, {
                prefix: "/api/rpc",
                context: {
                  headers: request.headers,
                  transport: "rpc",
                  ports,
                  receipt: {},
                  ...(request.headers.get(ASSISTANT_HEADER) ? { assistant: true } : {}),
                },
              });
              return response ?? new Response(null, { status: 404 });
            },
          }),
        );
        const [a, b, c] = path.split(".") as [string, string, string];
        return client[a][b][c](input);
      };

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@srf.test" });
      await louezDb.db.insert(louezDb.stores).values([
        {
          id: STORE,
          userId: OWNER,
          name: "Refunds store",
          slug: "srf-store-a",
          settings: SETTINGS,
          stripeAccountId: ACCOUNT,
        },
        { id: OTHER_STORE, userId: OWNER, name: "Other store", slug: "srf-store-b" },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: STORE, userId: OWNER, role: "owner" },
        { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      ]);
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@srf.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      stripe.creates.length = 0;
      stripe.behaviours.length = 0;
    });

    type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
    const WRITE: Permissions = {
      reservations: "read",
      products: "read",
      customers: "read",
      categories: "read",
      payments: "write",
      analytics: "read",
      settings: "read",
    };
    async function key(permissions: Permissions = WRITE) {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Refunds agent",
        permissions,
      });
      return `Bearer ${created.key}`;
    }

    /** A reservation with a payment taken online of `minor`, and its charge at the fake. */
    async function onlinePayment(
      options: {
        currency?: string;
        minor?: number;
        method?: "stripe" | "cash";
        storeId?: string;
      } = {},
    ) {
      counter += 1;
      const currency = options.currency ?? "EUR";
      const minor = options.minor ?? 12_000;
      const reservationId = `srf_res_${String(counter).padStart(13, "0")}`;
      const paymentId = `srf_pay_${String(counter).padStart(13, "0")}`;
      const chargeId = `ch_srf_${counter}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId: options.storeId ?? STORE,
        customerId: CUSTOMER,
        number: `2031-${String(counter).padStart(4, "0")}`,
        status: "confirmed",
        currency,
        startDate: new Date("2031-06-01T09:00:00Z"),
        endDate: new Date("2031-06-03T09:00:00Z"),
        subtotalAmount: "120.00",
        depositAmount: "0.00",
        totalAmount: "120.00",
      });
      const zeroDecimal = currency === "JPY";
      await louezDb.db.insert(louezDb.payments).values({
        id: paymentId,
        reservationId,
        amount: zeroDecimal ? String(minor) : (minor / 100).toFixed(2),
        type: "rental",
        method: options.method ?? "stripe",
        status: "completed",
        stripePaymentIntentId: `pi_srf_${counter}`,
        stripeChargeId: chargeId,
        stripeAccountId: ACCOUNT,
        currency,
        grossMinor: minor,
        paidAt: new Date("2031-05-20T10:00:00Z"),
      });
      stripe.charges.set(chargeId, { currency, captured: minor, refunds: [] });
      return { reservationId, paymentId, chargeId };
    }

    const textOf = (result: ToolResult) =>
      (result.content as Array<{ type: string; text?: string }>)
        .map((b) => b.text ?? "")
        .join("\n");
    const errorOf = (result: ToolResult) =>
      (result.structuredContent as { error?: { code?: string; details?: Json } } | undefined)
        ?.error;
    function answer(result: ToolResult) {
      assert.notEqual(result.isError, true, textOf(result));
      return result.structuredContent as {
        refund: {
          id: string;
          status: string;
          detail: string | null;
          amount: string;
          currency: string;
          failure: Json | null;
        };
      };
    }
    function approvalOf(result: ToolResult) {
      const error = errorOf(result);
      assert.equal(error?.code, "APPROVAL_REQUIRED", textOf(result));
      const id = (error?.details?.approval as { id?: string } | undefined)?.id;
      assert.ok(id);
      return id;
    }
    const approvalRow = async (id: string) => {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, id));
      assert.ok(row);
      return row;
    };
    async function approve(id: string) {
      const row = await approvalRow(id);
      await rpc(OWNER, "dashboard.handoffs.decide", {
        id,
        decision: "approve",
        revision: row.revision,
        shown: row.bindingHash,
        acknowledged: true,
      });
    }
    const approvalsCount = async () =>
      (await louezDb.db.select({ id: louezDb.apiHandoffs.id }).from(louezDb.apiHandoffs)).length;
    const operationsOf = (paymentId: string) =>
      louezDb.db
        .select({
          id: louezDb.paymentRefundOperations.id,
          status: louezDb.paymentRefundOperations.status,
          approvalId: louezDb.paymentRefundOperations.approvalId,
        })
        .from(louezDb.paymentRefundOperations)
        .where(orm.eq(louezDb.paymentRefundOperations.paymentId, paymentId));

    /** Asks, approves and carries the refund out; answers the carried-out call. */
    async function refunded(authorization: string, args: Json) {
      const id = approvalOf(await mcpCall(authorization, "refund_payment", args));
      await approve(id);
      return {
        id,
        result: await mcpCall(authorization, "refund_payment", { ...args, confirmationToken: id }),
      };
    }

    test("each refusal answers before anything is asked", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      const byHand = await onlinePayment({ method: "cash" });
      const elsewhere = await onlinePayment({ storeId: OTHER_STORE });
      const yen = await onlinePayment({ currency: "JPY", minor: 5_000 });
      const before = await approvalsCount();
      for (const [args, code] of [
        [{ paymentId: paid.paymentId, amount: "0" }, "REFUND_AMOUNT_INVALID"],
        [{ paymentId: paid.paymentId, amount: "-5.00" }, "REFUND_AMOUNT_INVALID"],
        [{ paymentId: yen.paymentId, amount: "10.50" }, "REFUND_AMOUNT_INVALID"],
        [{ paymentId: byHand.paymentId, amount: "10.00" }, "REFUND_PAYMENT_TAKEN_BY_HAND"],
        [{ paymentId: elsewhere.paymentId, amount: "10.00" }, "PAYMENT_NOT_FOUND"],
        [{ paymentId: paid.paymentId, amount: "120.01" }, "REFUND_EXCEEDS_REFUNDABLE"],
      ] as const) {
        const result = await mcpCall(authorization, "refund_payment", args);
        assert.equal(errorOf(result)?.code, code, JSON.stringify(args));
      }
      const unknown = await mcpCall(authorization, "refund_payment", {
        paymentId: paid.paymentId,
        amount: "10.00",
        notifyCustomer: true,
      });
      assert.equal(unknown.isError, true);
      assert.equal(await approvalsCount(), before);
      assert.deepEqual(stripe.creates, []);
    });

    test("a dashboard session is refused; the assistant acting for one is asked a person's approval", async () => {
      const paid = await onlinePayment();
      await assert.rejects(
        rpc(OWNER, "dashboard.payments.refund", { paymentId: paid.paymentId, amount: "10.00" }),
        (error: { code?: string; data?: { code?: string } }) =>
          error.data?.code === "REFUND_NOT_FROM_DASHBOARD" ||
          error.code === "REFUND_NOT_FROM_DASHBOARD",
      );
      await assert.rejects(
        rpc(
          OWNER,
          "dashboard.payments.refund",
          { paymentId: paid.paymentId, amount: "10.00" },
          { [ASSISTANT_HEADER]: "1" },
        ),
        (error: { data?: { code?: string } }) => error.data?.code === "APPROVAL_REQUIRED",
      );
      assert.deepEqual(stripe.creates, []);
      assert.deepEqual(await operationsOf(paid.paymentId), []);
    });

    test("an approval for 45.00 is carried out once: one operation with its id, one request to Stripe", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      const args = { paymentId: paid.paymentId, amount: "45.00" };
      const id = approvalOf(await mcpCall(authorization, "refund_payment", args));
      // What the person sees: the refund, back to the card that paid.
      const row = await approvalRow(id);
      assert.match(JSON.stringify(row), /refundToCard/);
      await approve(id);
      const done = answer(
        await mcpCall(authorization, "refund_payment", { ...args, confirmationToken: id }),
      );

      assert.equal(done.refund.status, "succeeded");
      assert.equal(done.refund.amount, "45.00");
      const operations = await operationsOf(paid.paymentId);
      assert.deepEqual(
        operations.map((o) => [o.status, o.approvalId]),
        [["succeeded", id]],
      );
      assert.deepEqual(stripe.creates, [`refund:${operations[0]?.id}`]);

      // The same approval again: used, nothing more.
      const again = await mcpCall(authorization, "refund_payment", {
        ...args,
        confirmationToken: id,
      });
      assert.equal(errorOf(again)?.code, "APPROVAL_INVALID");
      assert.equal((errorOf(again)?.details as { reason?: string })?.reason, "used");
      assert.equal(stripe.creates.length, 1);

      // A second partial refund, then the rest is refused past what is left.
      const second = answer(
        (await refunded(authorization, { paymentId: paid.paymentId, amount: "75.00" })).result,
      );
      assert.equal(second.refund.status, "succeeded");
      const over = await mcpCall(authorization, "refund_payment", {
        paymentId: paid.paymentId,
        amount: "0.01",
      });
      assert.equal(errorOf(over)?.code, "REFUND_EXCEEDS_REFUNDABLE");
    });

    test("a refund landing between the approval and its carrying out ends the approval: state_changed, nothing sent", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      const args = { paymentId: paid.paymentId, amount: "40.00" };
      const id = approvalOf(await mcpCall(authorization, "refund_payment", args));
      await approve(id);
      // A refund the store gave meanwhile, through another approved call.
      answer(
        (await refunded(authorization, { paymentId: paid.paymentId, amount: "10.00" })).result,
      );
      stripe.creates.length = 0;

      const late = await mcpCall(authorization, "refund_payment", {
        ...args,
        confirmationToken: id,
      });
      assert.equal(errorOf(late)?.code, "APPROVAL_INVALID");
      assert.equal((errorOf(late)?.details as { reason?: string })?.reason, "state_changed");
      assert.deepEqual(stripe.creates, []);
      assert.equal((await operationsOf(paid.paymentId)).length, 1);
    });

    test("Stripe does not answer: pending, never an error; get_refund reads it succeeded later", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      stripe.behaviours.push("lost_after");
      stripe.failures.list = 1;
      const { result } = await refunded(authorization, {
        paymentId: paid.paymentId,
        amount: "30.00",
      });
      const pending = answer(result);
      assert.equal(pending.refund.status, "pending");
      assert.equal(pending.refund.detail, "sending");

      const read = answer(
        await mcpCall(authorization, "get_refund", {
          paymentId: paid.paymentId,
          refundId: pending.refund.id,
        }),
      );
      assert.equal(read.refund.status, "succeeded");
      // One refund at Stripe, whatever was sent again under its key.
      assert.equal(stripe.charges.get(paid.chargeId)?.refunds.length, 1);
    });

    test("Stripe refuses after the approval: failed with the reason, the approval spent", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      stripe.behaviours.push({ refuse: "charge_disputed" });
      const args = { paymentId: paid.paymentId, amount: "30.00" };
      const { id, result } = await refunded(authorization, args);
      const failed = answer(result);
      assert.equal(failed.refund.status, "failed");
      assert.equal(failed.refund.failure?.code, "charge_disputed");
      const again = await mcpCall(authorization, "refund_payment", {
        ...args,
        confirmationToken: id,
      });
      assert.equal((errorOf(again)?.details as { reason?: string })?.reason, "used");
    });

    test("two approvals for the whole payment carried out at once: the second is refused by the first", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      const args = { paymentId: paid.paymentId, amount: "120.00" };
      const first = approvalOf(await mcpCall(authorization, "refund_payment", args));
      await approve(first);
      const second = approvalOf(
        await mcpCall(authorization, "refund_payment", { ...args, reason: "duplicate" }),
      );
      await approve(second);
      const results = await raceOnLockedRow(
        database,
        { table: "reservations", id: paid.reservationId },
        [
          () => mcpCall(authorization, "refund_payment", { ...args, confirmationToken: first }),
          () =>
            mcpCall(authorization, "refund_payment", {
              ...args,
              reason: "duplicate",
              confirmationToken: second,
            }),
        ],
      );
      const codes = results.map((r) => (r.isError ? errorOf(r)?.code : "ok")).sort();
      assert.deepEqual(codes, ["REFUND_EXCEEDS_REFUNDABLE", "ok"]);
      assert.equal(stripe.charges.get(paid.chargeId)?.refunds.length, 1);
    });

    test("a payment in another currency, and one in yen, are refunded in their own units", async () => {
      const authorization = await key();
      const francs = await onlinePayment({ currency: "CHF" });
      const chf = answer(
        (await refunded(authorization, { paymentId: francs.paymentId, amount: "20.00" })).result,
      );
      assert.deepEqual([chf.refund.amount, chf.refund.currency], ["20.00", "CHF"]);
      const yen = await onlinePayment({ currency: "JPY", minor: 5_000 });
      const jpy = answer(
        (await refunded(authorization, { paymentId: yen.paymentId, amount: "1500" })).result,
      );
      assert.deepEqual([jpy.refund.amount, jpy.refund.currency], ["1500", "JPY"]);
      assert.equal(stripe.charges.get(yen.chargeId)?.refunds[0]?.amount, 1_500);
    });

    test("REST answers as MCP does; a read-only key reads a refund and cannot refund", async () => {
      const authorization = await key();
      const paid = await onlinePayment();
      const first = await openApi(
        "POST",
        `/payments/${paid.paymentId}/refunds`,
        { amount: "10.00" },
        {
          authorization,
        },
      );
      assert.equal(first.status, 412);
      const body = (await first.json()) as { data?: { details?: { approval?: { id: string } } } };
      const id = body.data?.details?.approval?.id;
      assert.ok(id);
      await approve(id);
      const done = await openApi(
        "POST",
        `/payments/${paid.paymentId}/refunds`,
        { amount: "10.00" },
        {
          authorization,
          "louez-confirmation": id,
        },
      );
      assert.equal(done.status, 200, await done.clone().text());
      const refund = ((await done.json()) as { refund: { id: string; status: string } }).refund;
      assert.equal(refund.status, "succeeded");

      const reader = await key({ ...WRITE, payments: "read" });
      const read = await openApi("GET", `/payments/${paid.paymentId}/refunds/${refund.id}`, null, {
        authorization: reader,
      });
      assert.equal(read.status, 200);
      const refused = await mcpCall(reader, "refund_payment", {
        paymentId: paid.paymentId,
        amount: "5.00",
      });
      assert.equal(refused.isError, true);

      // Another store's payment, and a refund with no operation (made in Stripe's own
      // dashboard), are not found.
      const elsewhere = await openApi(
        "GET",
        `/payments/${paid.paymentId}/refunds/no_such_refund_00001`,
        null,
        {
          authorization: reader,
        },
      );
      assert.equal(elsewhere.status, 404);
    });
  },
);

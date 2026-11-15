import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import type { RecordedRefund } from "@louez/api/platform/ports";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";

// A dashboard session, read from a test header: Better Auth stays out. The
// person decides an approval with it, as the approval's page does.
const SESSION_HEADER = "x-test-session-user";
mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@rf.test` } } : null;
        },
      },
    },
  },
});

// A refund the store gave by hand, as a connected assistant records it
// (record_refund) and as the REST API serves it (POST /payments/{id}/refunds):
// through the real MCP and OpenAPI handlers, with an API key, on a database,
// the key's owner approving through the dashboard's RPC handler with their
// session, as the approval's page does. What it previews and binds its
// approval to, what it writes (one positive row pointing at the payment, in
// the payment's own currency, the payment left as it was), each refusal and
// its code before anything is asked, the ceiling under the reservation's
// lock, the replay of an idempotency key, and the credit note asked once the
// refund is committed (docs/domain/reservation-invariants.md, M8).
//
// The app's writer (apps/web lib/api/payment-refunds-port.ts) stands in here:
// it notes the refund and writes its row and the reservation's billing mark
// with the caller's transaction, as `insertManualRefund` does; its credit
// note is a number, or a failure the refund outlives.

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const OWNER = "rf_owner_user_000001";
const STORE = "rf_store_a_000000001";
const OTHER_STORE = "rf_store_b_000000001";
const CUSTOMER = "rf_customer_00000001";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "CHF",
} as const;

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Json = Record<string, unknown>;
type PaymentType =
  | "rental"
  | "deposit"
  | "deposit_hold"
  | "deposit_capture"
  | "deposit_return"
  | "damage"
  | "adjustment";

describe(
  "refunds given by hand, through MCP and REST (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let apiKeys: typeof import("@louez/api/services");
    let orm: typeof import("drizzle-orm");
    let refunds: typeof import("@louez/api/services/payment-records");
    let mcpCall: (authorization: string, name: string, args: object) => Promise<ToolResult>;
    let mcpTools: (
      authorization: string,
    ) => Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]>;
    let openApi: (
      method: string,
      path: string,
      body: object | null,
      headers: Record<string, string>,
    ) => Promise<Response>;
    let openApiDocument: () => Promise<{ paths: Record<string, Record<string, Json>> }>;
    let rpc: (user: string, path: string, input: object) => Promise<unknown>;
    let recorded: RecordedRefund[] = [];
    let creditNotes: Array<{
      paymentId: string;
      refundId: string;
      amount: string;
      source: string;
    }> = [];
    /** What the next credit note does: a number, none, or a failure. */
    let creditNoteOutcome: "number" | "none" | "throws" = "number";

    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: () => {},
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: () => {},
      paymentRecords: {
        facts: async () => {
          throw new Error("the recorded payment's writer is not reached");
        },
        insert: async () => {
          throw new Error("the recorded payment's writer is not reached");
        },
      },
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
              refundOfPaymentId: refund.paymentId,
              currency: refund.currency,
              origin: "manual",
              notes: refund.notes,
              paidAt: refund.paidAt,
            })
            .$returningId();
          await louezDb.markReservation(tx, { id: refund.reservationId, storeId: refund.storeId });
          return { id: String(row?.id) };
        },
        creditNote: async (refund: {
          paymentId: string;
          refundId: string;
          amount: string;
          source: string;
        }) => {
          creditNotes.push(refund);
          if (creditNoteOutcome === "throws") throw new Error("The invoicing failed.");
          return creditNoteOutcome === "number" ? `AV-${creditNotes.length}` : null;
        },
      },
    };

    before(async () => {
      database = await createTestDatabase("mcp_payment_refunds");
      louezDb = await import("@louez/db");
      apiKeys = await import("@louez/api/services");
      orm = await import("drizzle-orm");
      refunds = await import("@louez/api/services/payment-records");
      const { appRouter } = await import("@louez/api/router");
      const { createExposure } = await import("@louez/api/platform/exposure");
      const { handleMcpRequest } = await import("./transports/http");
      const exposure = createExposure(appRouter);
      const { createApiReference, createOpenApiHandler, handleOpenApiRequest } =
        await import("@louez/api/platform/openapi");

      const openApiHandler = createOpenApiHandler(exposure.router);
      const reference = createApiReference(exposure.router);
      const serveOpenApi = async (request: Request) =>
        (await handleOpenApiRequest(openApiHandler, request, { ports, reference })) ??
        new Response(null, { status: 404 });
      openApi = (method, path, body, headers) =>
        serveOpenApi(
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
        );
      openApiDocument = async () =>
        (await serveOpenApi(new Request("http://louez.test/api/v1/openapi.json"))).json();

      const httpOptions = { ports, procedures: exposure.procedures };
      const connect = async (authorization: string) => {
        const mcp = new Client({ name: "test", version: "0.0.0" });
        await mcp.connect(
          new StreamableHTTPClientTransport(new URL("http://louez.test/api/mcp"), {
            requestInit: { headers: { authorization } },
            fetch: (url, init) => handleMcpRequest(new Request(url, init), httpOptions),
          }),
        );
        return mcp;
      };
      mcpCall = async (authorization, name, args) => {
        const mcp = await connect(authorization);
        try {
          return await mcp.callTool({ name, arguments: args as Json });
        } finally {
          await mcp.close();
        }
      };
      mcpTools = async (authorization) => {
        const mcp = await connect(authorization);
        try {
          return (await mcp.listTools()).tools;
        } finally {
          await mcp.close();
        }
      };

      const { RPCHandler } = await import("@orpc/server/fetch");
      const { createORPCClient } = await import("@orpc/client");
      const { RPCLink } = await import("@orpc/client/fetch");
      const rpcHandler = new RPCHandler(appRouter);
      rpc = (user, path, input) => {
        const client = createORPCClient<
          Record<string, Record<string, Record<string, (input: object) => Promise<unknown>>>>
        >(
          new RPCLink({
            url: "http://louez.test/api/rpc",
            headers: { [SESSION_HEADER]: user, cookie: `louez_active_store=${STORE}` },
            fetch: async (request) => {
              const { response } = await rpcHandler.handle(request, {
                prefix: "/api/rpc",
                context: { headers: request.headers, transport: "rpc", ports, receipt: {} },
              });
              return response ?? new Response(null, { status: 404 });
            },
          }),
        );
        const [a, b, c] = path.split(".") as [string, string, string];
        return client[a][b][c](input);
      };

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@rf.test" });
      await louezDb.db.insert(louezDb.stores).values([
        { id: STORE, userId: OWNER, name: "Refunds store", slug: "rf-store-a", settings: SETTINGS },
        { id: OTHER_STORE, userId: OWNER, name: "Other store", slug: "rf-store-b" },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: STORE, userId: OWNER, role: "owner" },
        { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      ]);
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@rf.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      recorded = [];
      creditNotes = [];
      creditNoteOutcome = "number";
      await louezDb.db.delete(louezDb.billingSyncQueue);
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

    let counter = 0;
    async function reservation(options: { storeId?: string; currency?: string } = {}) {
      counter += 1;
      const id = `rf_res_${String(counter).padStart(14, "0")}`;
      const number = `2031-${String(counter).padStart(4, "0")}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: options.storeId ?? STORE,
        customerId: CUSTOMER,
        number,
        status: "confirmed",
        currency: options.currency ?? "CHF",
        startDate: new Date("2031-06-01T09:00:00Z"),
        endDate: new Date("2031-06-03T09:00:00Z"),
        subtotalAmount: "80.00",
        depositAmount: "50.00",
        totalAmount: "80.00",
      });
      return { id, number };
    }

    /** A payment row as a fixture: taken by hand unless said otherwise, completed, in CHF. */
    async function payment(
      reservationId: string,
      row: {
        type?: PaymentType;
        amount: string;
        method?: "cash" | "card" | "transfer" | "stripe";
        status?: "pending" | "completed" | "failed" | "refunded";
        currency?: string | null;
        refundOfPaymentId?: string;
        stripeRefundId?: string;
      },
    ) {
      const [inserted] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId,
          type: row.type ?? "rental",
          amount: row.amount,
          method: row.method ?? "card",
          status: row.status ?? "completed",
          currency: row.currency === undefined ? "CHF" : row.currency,
          refundOfPaymentId: row.refundOfPaymentId,
          stripeRefundId: row.stripeRefundId,
          paidAt: new Date("2031-05-20T10:00:00Z"),
        })
        .$returningId();
      return inserted.id;
    }

    const link = (reservationId: string) =>
      `${TEST_APP_URL}/dashboard/reservations/${reservationId}?store=${STORE}`;

    const errorOf = (result: ToolResult) =>
      (
        result.structuredContent as
          | {
              error?: {
                code?: string;
                message?: string;
                details?: Record<string, unknown> & {
                  preview?: unknown;
                  approval?: { id: string };
                  reason?: string;
                };
              };
            }
          | undefined
      )?.error;

    const textOf = (result: ToolResult) =>
      (result.content as Array<{ type: string; text?: string }>)
        .map((block) => block.text ?? "")
        .join("\n");

    function answer(result: ToolResult) {
      assert.notEqual(result.isError, true, textOf(result));
      return result.structuredContent as Json;
    }

    function approval(result: ToolResult) {
      assert.equal(result.isError, true, textOf(result));
      const error = errorOf(result);
      assert.equal(error?.code, "APPROVAL_REQUIRED", textOf(result));
      const id = error?.details?.approval?.id;
      assert.ok(id);
      return { preview: error?.details?.preview, id };
    }

    const approvalRow = async (id: string) => {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, id));
      assert.ok(row, `approval ${id}`);
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
      assert.equal((await approvalRow(id)).status, "approved");
    }

    async function approved(authorization: string, args: Json) {
      const { id } = approval(await mcpCall(authorization, "record_refund", args));
      await approve(id);
      return mcpCall(authorization, "record_refund", { ...args, confirmationToken: id });
    }

    function refusal(result: ToolResult) {
      assert.equal(result.isError, true, textOf(result));
      const error = errorOf(result);
      return { code: error?.code, message: error?.message, details: error?.details };
    }

    const approvalCount = async () =>
      (
        await louezDb.db
          .select({ id: louezDb.apiHandoffs.id })
          .from(louezDb.apiHandoffs)
          .where(
            orm.and(
              orm.eq(louezDb.apiHandoffs.storeId, STORE),
              orm.eq(louezDb.apiHandoffs.kind, "operation_approval"),
            ),
          )
      ).length;

    /** The refunds recorded against a payment; rows made in the same second come in no set order. */
    const refundsOf = (paymentId: string) =>
      louezDb.db
        .select({
          amount: louezDb.payments.amount,
          type: louezDb.payments.type,
          method: louezDb.payments.method,
          status: louezDb.payments.status,
          currency: louezDb.payments.currency,
          origin: louezDb.payments.origin,
          notes: louezDb.payments.notes,
        })
        .from(louezDb.payments)
        .where(orm.eq(louezDb.payments.refundOfPaymentId, paymentId))
        .orderBy(louezDb.payments.createdAt, louezDb.payments.id);

    const amountOf = async (paymentId: string) => {
      const [row] = await louezDb.db
        .select({ amount: louezDb.payments.amount, status: louezDb.payments.status })
        .from(louezDb.payments)
        .where(orm.eq(louezDb.payments.id, paymentId));
      return row;
    };

    test("record_refund is listed for a connection that writes payments, and REST documents it with the approval's answers", async () => {
      const tool = (await mcpTools(await key())).find((entry) => entry.name === "record_refund");
      assert.ok(tool, "record_refund is listed");
      assert.equal(tool.title, "Record Refund");
      assert.deepEqual(
        {
          readOnlyHint: tool.annotations?.readOnlyHint,
          destructiveHint: tool.annotations?.destructiveHint,
          openWorldHint: tool.annotations?.openWorldHint,
        },
        { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      );
      assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
        "amount",
        "confirmationToken",
        "idempotencyKey",
        "method",
        "notes",
        "paymentId",
      ]);
      assert.match(tool.description ?? "", /REFUND_STRIPE_PAYMENT/);
      assert.match(tool.description ?? "", /not available through this action yet/);
      // A connection that only reads payments does not see it.
      const reading = await mcpTools(await key({ ...WRITE, payments: "read" }));
      assert.equal(
        reading.some((entry) => entry.name === "record_refund"),
        false,
      );

      const document = await openApiDocument();
      const entry = document.paths["/payments/{paymentId}/refunds"]?.post as
        | {
            operationId?: string;
            tags?: string[];
            responses?: Record<string, unknown>;
            parameters?: Array<{ $ref?: string }>;
          }
        | undefined;
      assert.ok(entry, "POST /payments/{paymentId}/refunds is documented");
      assert.equal(entry.operationId, "record_refund");
      assert.deepEqual(entry.tags, ["Payments"]);
      assert.deepEqual(
        [entry.responses?.["409"], entry.responses?.["412"], entry.responses?.["429"]],
        [
          { $ref: "#/components/responses/ApprovalDeclined" },
          { $ref: "#/components/responses/ApprovalRequired" },
          { $ref: "#/components/responses/ApprovalsFull" },
        ],
      );
      assert.deepEqual(
        (entry.parameters ?? []).flatMap((parameter) =>
          parameter.$ref ? [parameter.$ref.split("/").pop()] : [],
        ),
        ["IdempotencyKey", "LouezConfirmation"],
      );
    });

    test("record_refund asks the person first with the refund, the payment and what is left, then writes one row in the payment's currency", async () => {
      const authorization = await key();
      const { id, number } = await reservation();
      const paid = await payment(id, { amount: "80.00" });
      await payment(id, { amount: "20.00", method: "cash", refundOfPaymentId: paid });
      const args = {
        paymentId: paid,
        amount: "30.00",
        method: "cash",
        notes: " given at the desk ",
      };

      const first = approval(await mcpCall(authorization, "record_refund", args));
      assert.deepEqual(first.preview, {
        // Intl writes a no-break space after the code.
        summary: `Record a refund of CHF\u00a030.00 (cash) of the rental payment of CHF\u00a080.00 on reservation #${number}.`,
        details: {
          sensitive: "money",
          paymentId: paid,
          reservationId: id,
          number,
          amount: "30.00",
          method: "cash",
          currency: "CHF",
          payment: { type: "rental", amount: "80.00", method: "card" },
          alreadyRefunded: "20.00",
          refundableAfter: "30.00",
          notes: "given at the desk",
        },
      });
      assert.deepEqual(recorded, [], "nothing is written before the approval");
      // The person reads the refund, the payment and what is left, in the payment's currency.
      const display = (await approvalRow(first.id)).payload as {
        display?: { headline: { key: string }; facts: Array<{ key: string; values: Json }> };
      };
      assert.equal(display.display?.headline.key, "recordRefund");
      assert.deepEqual(
        display.display?.facts.map((fact) => fact.key),
        ["bookingNumber", "refundGiven", "refundOf", "refundBalance", "recordOnly"],
      );
      assert.deepEqual(display.display?.facts[3]?.values, {
        refunded: { type: "money", amount: "20.00", currency: "CHF" },
        left: { type: "money", amount: "30.00", currency: "CHF" },
      });

      await approve(first.id);
      const done = await mcpCall(authorization, "record_refund", {
        ...args,
        confirmationToken: first.id,
      });
      const facts = answer(done);
      assert.ok(typeof facts.refundId === "string" && facts.refundId.length > 0);
      assert.deepEqual(
        { ...facts, refundId: "(id)" },
        {
          refundId: "(id)",
          paymentId: paid,
          reservationId: id,
          number,
          amount: "30.00",
          currency: "CHF",
          method: "cash",
          creditNoteNumber: "AV-1",
          links: { dashboard: link(id) },
        },
      );
      const written = (await refundsOf(paid)).sort((a, b) => a.amount.localeCompare(b.amount));
      assert.deepEqual(written, [
        {
          amount: "20.00",
          type: "rental",
          method: "cash",
          status: "completed",
          currency: "CHF",
          // The earlier refund, a fixture.
          origin: null,
          notes: null,
        },
        {
          amount: "30.00",
          type: "rental",
          method: "cash",
          status: "completed",
          currency: "CHF",
          origin: "manual",
          notes: "given at the desk",
        },
      ]);
      assert.deepEqual(
        await amountOf(paid),
        { amount: "80.00", status: "completed" },
        "the payment stays gross",
      );
      // The credit note comes once committed, for this refund and its payment.
      assert.deepEqual(creditNotes, [
        { paymentId: paid, refundId: facts.refundId, amount: "30.00", source: "api_record_refund" },
      ]);
    });

    test("a payment in another currency than its reservation's is refunded, shown and refused in that currency", async () => {
      const authorization = await key();
      const { id } = await reservation({ currency: "EUR" });
      const paid = await payment(id, { amount: "80.00", currency: "GBP" });

      const asked = approval(
        await mcpCall(authorization, "record_refund", {
          paymentId: paid,
          amount: "30.00",
          method: "transfer",
        }),
      );
      assert.match(
        (asked.preview as { summary: string }).summary,
        /refund of £30\.00 .* payment of £80\.00/,
      );
      const row = await approvalRow(asked.id);
      const shown = row.payload as { display?: { facts: Array<{ values: Json }> } };
      assert.deepEqual(shown.display?.facts[1]?.values.amount, {
        type: "money",
        amount: "30.00",
        currency: "GBP",
      });

      await approve(asked.id);
      const done = answer(
        await mcpCall(authorization, "record_refund", {
          paymentId: paid,
          amount: "30.00",
          method: "transfer",
          confirmationToken: asked.id,
        }),
      );
      assert.equal(done.currency, "GBP");
      assert.deepEqual(
        (await refundsOf(paid)).map((refund) => refund.currency),
        ["GBP"],
      );

      const over = refusal(
        await mcpCall(authorization, "record_refund", {
          paymentId: paid,
          amount: "60.00",
          method: "transfer",
        }),
      );
      assert.equal(over.code, "REFUND_EXCEEDS_REFUNDABLE");
      assert.equal(
        over.message,
        "Amount exceeds what is left to refund on this payment. Paid: £80.00, already refunded: £30.00, refundable: £50.00.",
      );
      assert.deepEqual(over.details, {
        paid: "80.00",
        refunded: "30.00",
        refundable: "50.00",
        currency: "GBP",
      });
    });

    test("the ceiling counts every completed refund already linked, and partial refunds follow one another up to it", async () => {
      const authorization = await key();
      const { id } = await reservation();
      const paid = await payment(id, { type: "damage", amount: "80.00" });
      // An earlier partial refund, completed; one that failed counts for nothing.
      await payment(id, { amount: "50.00", method: "cash", refundOfPaymentId: paid });
      await payment(id, {
        amount: "25.00",
        method: "cash",
        refundOfPaymentId: paid,
        status: "failed",
      });
      const asked = await approvalCount();

      const over = refusal(
        await mcpCall(authorization, "record_refund", {
          paymentId: paid,
          amount: "30.01",
          method: "cash",
        }),
      );
      assert.equal(over.code, "REFUND_EXCEEDS_REFUNDABLE");
      assert.deepEqual(over.details, {
        paid: "80.00",
        refunded: "50.00",
        refundable: "30.00",
        currency: "CHF",
      });
      assert.equal(
        await approvalCount(),
        asked,
        "nothing is asked for a refund that would be refused",
      );

      // Within it, twice: the second takes what the first left.
      answer(await approved(authorization, { paymentId: paid, amount: "10.00", method: "cash" }));
      answer(await approved(authorization, { paymentId: paid, amount: "20.00", method: "card" }));
      assert.deepEqual(
        (await refundsOf(paid))
          .filter((row) => row.status === "completed")
          .map((row) => row.amount)
          .sort(),
        ["10.00", "20.00", "50.00"],
      );
      // Nothing is left.
      const done = refusal(
        await mcpCall(authorization, "record_refund", {
          paymentId: paid,
          amount: "0.01",
          method: "cash",
        }),
      );
      assert.equal(done.code, "REFUND_EXCEEDS_REFUNDABLE");
      assert.equal((done.details as { refundable?: string }).refundable, "0.00");
    });

    test("each refusal answers its code before anything is asked, and writes nothing", async () => {
      const authorization = await key();
      const { id } = await reservation();
      const elsewhere = await reservation({ storeId: OTHER_STORE });
      const rental = await payment(id, { amount: "80.00" });
      const fixtures = {
        elsewhere: await payment(elsewhere.id, { amount: "80.00" }),
        refund: await payment(id, { amount: "5.00", method: "cash", refundOfPaymentId: rental }),
        stripeRefund: await payment(id, {
          amount: "5.00",
          method: "stripe",
          stripeRefundId: "re_rf_000000000001",
        }),
        deposit: await payment(id, { type: "deposit", amount: "50.00" }),
        depositReturn: await payment(id, { type: "deposit_return", amount: "50.00" }),
        depositHold: await payment(id, { type: "deposit_hold", amount: "50.00", method: "stripe" }),
        pending: await payment(id, { amount: "80.00", status: "pending" }),
        stripe: await payment(id, { amount: "80.00", method: "stripe" }),
        stripeCapture: await payment(id, {
          type: "deposit_capture",
          amount: "40.00",
          method: "stripe",
        }),
        paidBack: await payment(id, { type: "adjustment", amount: "-20.00", method: "cash" }),
      };
      const asked = await approvalCount();
      const call = (paymentId: string, amount = "10.00") =>
        mcpCall(authorization, "record_refund", { paymentId, amount, method: "cash" });

      const cases: Array<[string, string, string]> = [
        ["unknown", "rf_pay_nowhere", "PAYMENT_NOT_FOUND"],
        ["another store's", fixtures.elsewhere, "PAYMENT_NOT_FOUND"],
        ["a refund's own row", fixtures.refund, "REFUND_OF_REFUND"],
        ["a Stripe refund row", fixtures.stripeRefund, "REFUND_OF_REFUND"],
        ["a deposit", fixtures.deposit, "REFUND_PAYMENT_TYPE_NOT_REFUNDABLE"],
        ["a deposit return", fixtures.depositReturn, "REFUND_PAYMENT_TYPE_NOT_REFUNDABLE"],
        ["a deposit hold", fixtures.depositHold, "REFUND_PAYMENT_TYPE_NOT_REFUNDABLE"],
        ["a pending payment", fixtures.pending, "REFUND_PAYMENT_NOT_COMPLETED"],
        ["a Stripe payment", fixtures.stripe, "REFUND_STRIPE_PAYMENT"],
        ["a deposit kept through Stripe", fixtures.stripeCapture, "REFUND_STRIPE_PAYMENT"],
        ["money paid back", fixtures.paidBack, "REFUND_PAYMENT_NOT_RECEIVED"],
      ];
      for (const [what, paymentId, code] of cases) {
        assert.equal(refusal(await call(paymentId)).code, code, what);
      }
      const stripe = refusal(await call(fixtures.stripe));
      assert.equal(
        stripe.message,
        "This payment was taken online through Stripe. Refunds of online payments are not available through this action yet: it records only refunds of payments the store took by hand.",
      );
      for (const amount of ["0", "0.00", "-5.00", "1e2", "12.345", " 5", "123456789.00", "abc"]) {
        assert.equal(refusal(await call(rental, amount)).code, "REFUND_AMOUNT_INVALID", amount);
      }

      assert.equal(await approvalCount(), asked, "nothing was asked");
      assert.deepEqual(recorded, []);
      assert.deepEqual(
        (await refundsOf(rental)).map((row) => row.amount),
        ["5.00"],
      );
    });

    test("two refunds of the whole payment sent together: one is recorded, the other refused under the lock", async () => {
      // Each was previewed and approved with the whole payment refundable; the
      // second to take the reservation's lock reads the refund the first wrote,
      // and is refused by the ceiling before its approval is read.
      const authorization = await key();
      const { id } = await reservation();
      const paid = await payment(id, { amount: "80.00" });
      const cash = { paymentId: paid, amount: "80.00", method: "cash" };
      const card = { paymentId: paid, amount: "80.00", method: "card" };
      const tokens = [
        approval(await mcpCall(authorization, "record_refund", cash)).id,
        approval(await mcpCall(authorization, "record_refund", card)).id,
      ];
      for (const token of tokens) await approve(token);

      const results = await raceOnLockedRow(database, { table: "reservations", id }, [
        () => mcpCall(authorization, "record_refund", { ...cash, confirmationToken: tokens[0] }),
        () => mcpCall(authorization, "record_refund", { ...card, confirmationToken: tokens[1] }),
      ]);

      const won = results.filter((result) => result.isError !== true);
      const lost = results.filter((result) => result.isError === true);
      assert.equal(won.length, 1, results.map(textOf).join("\n---\n"));
      assert.equal(lost.length, 1);
      const [loser] = lost;
      assert.ok(loser);
      assert.equal(refusal(loser).code, "REFUND_EXCEEDS_REFUNDABLE");
      assert.equal((await refundsOf(paid)).length, 1);
      assert.equal(creditNotes.length, 1, "one credit note, for the refund recorded");
    });

    test("a refund recorded between the approval and the call that carries it out ends that approval", async () => {
      const authorization = await key();
      const { id } = await reservation();
      const paid = await payment(id, { amount: "80.00" });
      const args = { paymentId: paid, amount: "30.00", method: "cash" };

      // Another refund lands, still within what is left: the approval is void all the same.
      const first = approval(await mcpCall(authorization, "record_refund", args));
      await approve(first.id);
      await payment(id, { amount: "5.00", method: "cash", refundOfPaymentId: paid });
      const late = refusal(
        await mcpCall(authorization, "record_refund", { ...args, confirmationToken: first.id }),
      );
      assert.equal(late.code, "APPROVAL_INVALID");
      assert.equal(late.details?.reason, "state_changed");

      // The payment's own amount changed: the same.
      const second = approval(await mcpCall(authorization, "record_refund", args));
      await approve(second.id);
      await louezDb.db
        .update(louezDb.payments)
        .set({ amount: "90.00" })
        .where(orm.eq(louezDb.payments.id, paid));
      const moved = refusal(
        await mcpCall(authorization, "record_refund", { ...args, confirmationToken: second.id }),
      );
      assert.equal(moved.code, "APPROVAL_INVALID");
      assert.equal(moved.details?.reason, "state_changed");

      // Another amount than the approved one is another request.
      const third = approval(await mcpCall(authorization, "record_refund", args));
      await approve(third.id);
      const other = refusal(
        await mcpCall(authorization, "record_refund", {
          ...args,
          amount: "31.00",
          confirmationToken: third.id,
        }),
      );
      assert.equal(other.code, "APPROVAL_INVALID");
      assert.equal(other.details?.reason, "other_request");

      assert.deepEqual(recorded, [], "none of them ran");
      // An approval runs once.
      answer(
        await mcpCall(authorization, "record_refund", { ...args, confirmationToken: third.id }),
      );
      const again = refusal(
        await mcpCall(authorization, "record_refund", { ...args, confirmationToken: third.id }),
      );
      assert.equal(again.code, "APPROVAL_INVALID");
      assert.equal(again.details?.reason, "used");
      assert.equal(recorded.length, 1);
    });

    test("the same idempotency key replays the refund without writing again, on MCP and on REST", async () => {
      const authorization = await key();
      const { id } = await reservation();
      const paid = await payment(id, { amount: "80.00" });
      const args = {
        paymentId: paid,
        amount: "25.00",
        method: "cash",
        idempotencyKey: "rf-refund-1",
      };

      const done = await approved(authorization, args);
      const facts = answer(done);
      const replay = await mcpCall(authorization, "record_refund", args);
      assert.notEqual(replay.isError, true, textOf(replay));
      assert.deepEqual(replay.structuredContent, facts);
      assert.equal(replay._meta?.["io.louez/replayed"], true);
      const reused = refusal(
        await mcpCall(authorization, "record_refund", { ...args, amount: "26.00" }),
      );
      assert.equal(reused.code, "IDEMPOTENCY_KEY_REUSED");

      // REST: the person approves, the request with its key runs once, then replays.
      const path = `/payments/${paid}/refunds`;
      const body = { amount: "15.00", method: "transfer" };
      const headers = { authorization, "idempotency-key": "rf-refund-rest-1" };
      const asked = await openApi("POST", path, body, headers);
      assert.equal(asked.status, 412);
      const approvalId = (
        (await asked.json()) as { data: { details: { approval: { id: string } } } }
      ).data.details.approval.id;
      await approve(approvalId);
      const confirmed = { ...headers, "louez-confirmation": approvalId };
      const first = await openApi("POST", path, body, confirmed);
      assert.equal(first.status, 200, await first.clone().text());
      const firstBody = (await first.json()) as Json;
      assert.equal(firstBody.amount, "15.00");
      const second = await openApi("POST", path, body, confirmed);
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), firstBody);
      assert.equal(
        second.headers.get("louez-operation-id"),
        first.headers.get("louez-operation-id"),
      );

      assert.deepEqual((await refundsOf(paid)).map((row) => row.amount).sort(), ["15.00", "25.00"]);
      assert.equal(recorded.length, 2);
      assert.equal(creditNotes.length, 2, "a replay asks for no second credit note");
    });

    test("a credit note that fails or is not issued leaves the refund recorded, with no number", async () => {
      const authorization = await key();
      const { id } = await reservation();
      const paid = await payment(id, { amount: "80.00" });

      creditNoteOutcome = "throws";
      const failed = answer(
        await approved(authorization, { paymentId: paid, amount: "10.00", method: "cash" }),
      );
      assert.equal(failed.creditNoteNumber, null);
      creditNoteOutcome = "none";
      const none = answer(
        await approved(authorization, { paymentId: paid, amount: "20.00", method: "cash" }),
      );
      assert.equal(none.creditNoteNumber, null);
      assert.deepEqual((await refundsOf(paid)).map((row) => row.amount).sort(), ["10.00", "20.00"]);
    });

    test("the dashboard's writer refuses a payment of another reservation than its page's, and asks nothing", async () => {
      const { id } = await reservation();
      const other = await reservation();
      const paid = await payment(id, { amount: "80.00" });
      const caller = {
        storeId: STORE,
        storeSettings: null,
        port: ports.paymentRefunds,
        confirm: async () => {
          throw new Error("a session is never asked");
        },
      };
      await assert.rejects(
        refunds.recordPaymentRefund(
          caller,
          { reservationId: other.id, paymentId: paid, amount: "10.00", method: "cash" },
          { source: "test" },
        ),
        (error: { data?: { code?: string } }) => error.data?.code === "PAYMENT_NOT_FOUND",
      );
      assert.deepEqual(await refundsOf(paid), []);
    });
  },
);

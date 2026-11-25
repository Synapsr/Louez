import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import type { RecordedPayment, RecordedPaymentDraft } from "@louez/api/platform/ports";
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
          return id ? { user: { id, email: `${id}@pw.test` } } : null;
        },
      },
    },
  },
});

// The three payment writes as a connected assistant calls them: through the
// real MCP handler, with an API key, on a database. record_payment,
// record_deposit_return and delete_payment: what each previews and binds its
// approval to (the key's owner approves it through the dashboard's RPC
// handler with their session, as the approval's page does), what it writes (the payment through the app's writer, in the
// tool's transaction, and the billing mark), what it leaves alone (no history
// line), each refusal with its message, and who may call them. On the REST
// API, the transport's guards on their routes: the path names the record, a
// body in another content type than JSON is refused, a deletion takes none.
// An id sent in another case is written as stored.
//
// The app's writer adds the billing facts (currency, gross, insurance share):
// apps/web/lib/reservations/dashboard-payment-writes.db.test.ts and the
// assistant's tools (apps/web/lib/ai/tools.db.test.ts) hold those. Here a
// stand-in writer notes what it is handed and writes the row with the
// caller's transaction, as the real one does.

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const OWNER = "pw_owner_user_000001";
const MEMBER = "pw_member_user_00001";
const STORE = "pw_store_a_000000001";
const OTHER_STORE = "pw_store_b_000000001";
const CUSTOMER = "pw_customer_00000001";
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
type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

describe("payment writes through MCP (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let apiKeys: typeof import("@louez/api/services");
  let orm: typeof import("drizzle-orm");
  let mcpCall: (authorization: string, name: string, args: object) => Promise<ToolResult>;
  let mcpTools: (authorization: string) => Promise<ListedTool[]>;
  let openApi: (
    method: string,
    path: string,
    body: object | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  let openApiDocument: () => Promise<{ paths: Record<string, Record<string, Json>> }>;
  /** A request to the REST API as it is sent: any body, any content type. */
  let openApiRaw: (
    method: string,
    path: string,
    body: string | null,
    headers: Record<string, string>,
  ) => Promise<Response>;
  /** The dashboard's RPC handler, with a user's session on the store. */
  let rpc: (user: string, path: string, input: object) => Promise<unknown>;
  let recorded: RecordedPayment[] = [];
  /** Makes the next write fail once it wrote, as a writer that throws midway. */
  let failNextWrite = false;

  /**
   * A stand-in for the app's writer: it notes the payment it is handed, then
   * writes the row and the reservation's billing mark with the caller's
   * transaction, as the real one does.
   */
  const insertRecordedPayment = async (
    tx: import("@louez/db").Transaction,
    payment: RecordedPayment,
  ) => {
    recorded.push(payment);
    await tx.insert(louezDb.payments).values({
      reservationId: payment.reservationId,
      amount: payment.amount,
      type: payment.type,
      method: payment.method,
      status: "completed",
      origin: payment.origin,
      notes: payment.notes,
      paidAt: payment.paidAt,
    });
    await louezDb.markReservation(tx, { id: payment.reservationId, storeId: payment.storeId });
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error("The writer failed midway.");
    }
  };

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
    paymentRecords: { facts: recordedFacts, insert: insertRecordedPayment },
  };

  before(async () => {
    database = await createTestDatabase("mcp_payment_writes");
    louezDb = await import("@louez/db");
    apiKeys = await import("@louez/api/services");
    orm = await import("drizzle-orm");
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
    openApiRaw = (method, path, body, headers) =>
      serveOpenApi(
        new Request(`http://louez.test/api/v1${path}`, {
          method,
          headers,
          ...(body === null ? {} : { body }),
        }),
      );
    openApiDocument = async () =>
      (await serveOpenApi(new Request("http://louez.test/api/v1/openapi.json"))).json();

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
    };
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

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@pw.test" },
      { id: MEMBER, email: "member@pw.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "Payments store", slug: "pw-store-a", settings: SETTINGS },
      { id: OTHER_STORE, userId: OWNER, name: "Other store", slug: "pw-store-b" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
    ]);
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "ada@pw.test",
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

  async function key(
    permissions: Permissions = WRITE,
    options: { userId?: string; confirmSensitive?: boolean } = {},
  ) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: options.userId ?? OWNER,
      name: "Payments agent",
      permissions,
    });
    if (options.confirmSensitive === false) {
      await louezDb.db
        .update(louezDb.apiKeys)
        .set({ confirmSensitive: false })
        .where(orm.eq(louezDb.apiKeys.id, created.id));
    }
    return `Bearer ${created.key}`;
  }

  let counter = 0;
  async function reservation(
    status: "pending" | "confirmed" | "cancelled" | "rejected" = "confirmed",
    storeId = STORE,
    currency: string | null = null,
  ) {
    counter += 1;
    const id = `pw_res_${String(counter).padStart(14, "0")}`;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: CUSTOMER,
      number: `2030-${String(counter).padStart(4, "0")}`,
      status,
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "80.00",
      depositAmount: "50.00",
      totalAmount: "80.00",
      currency,
    });
    return { id, number: `2030-${String(counter).padStart(4, "0")}` };
  }

  /** A payment row as a fixture: a deposit collected, a Stripe charge… */
  async function payment(
    reservationId: string,
    row: {
      type: "rental" | "deposit" | "deposit_return" | "damage" | "adjustment";
      amount: string;
    },
    method: "cash" | "card" | "stripe" = "cash",
  ) {
    const [inserted] = await louezDb.db
      .insert(louezDb.payments)
      .values({ reservationId, ...row, method, status: "completed" })
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
              retryable?: boolean;
              details?: {
                confirmationToken?: string;
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

  /**
   * A success, as the bridge answers it: the facts as structured content, a
   * text that says it is done with the operation's receipt and the links on a
   * line of their own, and the receipt in `_meta`.
   */
  function answer(result: ToolResult) {
    assert.notEqual(result.isError, true, textOf(result));
    const facts = result.structuredContent as Json;
    const links = facts.links as { dashboard: string } | undefined;
    assert.equal(
      textOf(result),
      `Done. Operation ${String(result._meta?.["io.louez/operationId"])}.` +
        (links ? `\nLinks to give the user: dashboard ${links.dashboard}.` : "") +
        `\n${JSON.stringify(facts)}`,
    );
    assert.equal(result._meta?.["io.louez/replayed"], false);
    return facts;
  }

  /** The preview and the approval of a call that asks for the key's owner's approval. */
  function approval(result: ToolResult) {
    assert.equal(result.isError, true, textOf(result));
    const error = errorOf(result);
    assert.equal(error?.code, "APPROVAL_REQUIRED", textOf(result));
    const id = error?.details?.approval?.id;
    assert.ok(id);
    assert.equal(error?.details?.confirmationToken, id, "the id is the token the tool takes");
    return { preview: error?.details?.preview, id };
  }

  /** An approval's row. */
  const approvalRow = async (id: string) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, id));
    assert.ok(row, `approval ${id}`);
    return row;
  };

  /** The person approves on the approval's page: `handoffs.decide`, with their session, on RPC. */
  async function approve(id: string, user = OWNER) {
    const row = await approvalRow(id);
    await rpc(user, "dashboard.handoffs.decide", {
      id,
      decision: "approve",
      revision: row.revision,
      shown: row.bindingHash,
      acknowledged: true,
    });
    assert.equal((await approvalRow(id)).status, "approved");
  }

  /** Asks, the person approves, then the same call presents the approval's id. */
  async function approved(authorization: string, name: string, args: Json, user = OWNER) {
    const { id } = approval(await mcpCall(authorization, name, args));
    await approve(id, user);
    return mcpCall(authorization, name, { ...args, confirmationToken: id });
  }

  /** Why an approval presented did not let the call run (`APPROVAL_INVALID`). */
  function invalid(result: ToolResult) {
    const { code } = refusal(result);
    assert.equal(code, "APPROVAL_INVALID", textOf(result));
    return errorOf(result)?.details?.reason;
  }

  /** A refusal's facts: its domain's code, and the message the tools answered with. */
  function refusal(result: ToolResult) {
    assert.equal(result.isError, true, textOf(result));
    const error = errorOf(result);
    return { code: error?.code, message: error?.message, retryable: error?.retryable };
  }

  const withoutDate = ({ paidAt, ...rest }: RecordedPayment) => {
    assert.ok(paidAt instanceof Date);
    return rest;
  };

  const paymentsOf = (reservationId: string) =>
    louezDb.db
      .select({
        id: louezDb.payments.id,
        type: louezDb.payments.type,
        amount: louezDb.payments.amount,
        method: louezDb.payments.method,
        status: louezDb.payments.status,
        origin: louezDb.payments.origin,
        notes: louezDb.payments.notes,
      })
      .from(louezDb.payments)
      .where(orm.eq(louezDb.payments.reservationId, reservationId))
      .orderBy(louezDb.payments.type, louezDb.payments.amount);

  const marks = () =>
    louezDb.db
      .select({
        id: louezDb.billingSyncQueue.aggregateId,
        storeId: louezDb.billingSyncQueue.storeId,
        version: louezDb.billingSyncQueue.version,
      })
      .from(louezDb.billingSyncQueue)
      .where(orm.eq(louezDb.billingSyncQueue.aggregateType, "reservation"));

  const historyOf = (reservationId: string) =>
    louezDb.db
      .select({ type: louezDb.reservationActivity.activityType })
      .from(louezDb.reservationActivity)
      .where(orm.eq(louezDb.reservationActivity.reservationId, reservationId));

  /** The store's approval requests, and its confirmation tokens: none is issued for these writes. */
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
  const tokenCount = async () =>
    (
      await louezDb.db
        .select({ id: louezDb.apiConfirmations.id })
        .from(louezDb.apiConfirmations)
        .where(orm.eq(louezDb.apiConfirmations.storeId, STORE))
    ).length;

  /** The procedures the store's approvals were asked under. */
  const approvalProcedures = async () =>
    (
      await louezDb.db
        .selectDistinct({ procedure: louezDb.apiHandoffs.procedure })
        .from(louezDb.apiHandoffs)
        .where(
          orm.and(
            orm.eq(louezDb.apiHandoffs.storeId, STORE),
            orm.eq(louezDb.apiHandoffs.kind, "operation_approval"),
          ),
        )
    )
      .map((row) => String(row.procedure))
      .sort();

  /** The store's recorded operations of the payment writes. */
  const operations = () =>
    louezDb.db
      .select({
        procedure: louezDb.apiOperations.procedure,
        status: louezDb.apiOperations.status,
      })
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.storeId, STORE));

  test("the three writes are listed for a connection that may write payments, with their hints and arguments", async () => {
    const listed = await mcpTools(await key());
    const shape = (name: string) => {
      const tool = listed.find((entry) => entry.name === name);
      assert.ok(tool, `${name} is listed`);
      return {
        title: tool.title,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint,
          destructiveHint: tool.annotations?.destructiveHint,
          openWorldHint: tool.annotations?.openWorldHint,
        },
        arguments: Object.keys(tool.inputSchema.properties ?? {}).sort(),
        required: [...((tool.inputSchema.required as string[] | undefined) ?? [])].sort(),
      };
    };
    const additive = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    assert.deepEqual(shape("record_payment"), {
      title: "Record Payment",
      annotations: additive,
      arguments: [
        "amount",
        "confirmationToken",
        "idempotencyKey",
        "method",
        "notes",
        "reservationId",
        "type",
      ],
      required: ["amount", "method", "reservationId", "type"],
    });
    assert.deepEqual(shape("record_deposit_return"), {
      title: "Record Deposit Return",
      annotations: additive,
      arguments: [
        "amount",
        "confirmationToken",
        "idempotencyKey",
        "method",
        "notes",
        "reservationId",
      ],
      required: ["amount", "method", "reservationId"],
    });
    assert.deepEqual(shape("delete_payment"), {
      title: "Delete Payment",
      annotations: { ...additive, destructiveHint: true },
      arguments: ["confirmationToken", "idempotencyKey", "paymentId"],
      required: ["paymentId"],
    });

    // A connection that only reads payments sees list_payments alone.
    const reading = (await mcpTools(await key({ ...WRITE, payments: "read" }))).map(
      (tool) => tool.name,
    );
    assert.ok(reading.includes("list_payments"));
    for (const name of ["record_payment", "record_deposit_return", "delete_payment"]) {
      assert.ok(!reading.includes(name), `${name} is not listed`);
    }
  });

  test("record_payment asks the person first, then writes the payment once, with its billing mark and no history line", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    const args = {
      reservationId: id,
      type: "rental",
      amount: "80.00",
      method: "transfer",
      notes: "Paid by wire",
    };

    const first = approval(await mcpCall(authorization, "record_payment", args));
    assert.deepEqual(first.preview, {
      // In the reservation's currency: here the store's, francs.
      summary: `Record a rental payment of CHF\u00a080.00 (transfer) on reservation #${number}.`,
      details: {
        sensitive: "money",
        reservationId: id,
        number,
        type: "rental",
        amount: "80.00",
        method: "transfer",
        // Written with the row: shown before it is.
        notes: "Paid by wire",
      },
    });
    assert.deepEqual(recorded, [], "nothing was done yet");
    assert.deepEqual(await paymentsOf(id), []);
    assert.deepEqual(await marks(), []);
    assert.equal(await tokenCount(), 0, "no token is issued");

    await approve(first.id);
    const done = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: first.id,
    });
    assert.deepEqual(answer(done), {
      reservationId: id,
      number,
      type: "rental",
      amount: "80.00",
      method: "transfer",
      links: { dashboard: link(id) },
    });
    assert.deepEqual(recorded.map(withoutDate), [
      {
        reservationId: id,
        storeId: STORE,
        facts: { currency: "CHF", grossMinor: null, insuranceShareMinor: 0 },
        type: "rental",
        method: "transfer",
        amount: "80.00",
        origin: "manual",
        notes: "Paid by wire",
      },
    ]);
    assert.deepEqual(
      (await paymentsOf(id)).map(({ id: _id, ...row }) => row),
      [
        {
          type: "rental",
          amount: "80.00",
          method: "transfer",
          status: "completed",
          origin: "manual",
          notes: "Paid by wire",
        },
      ],
    );
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 1 }]);
    assert.deepEqual(await historyOf(id), [], "no history line");

    // An approval works once.
    const again = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: first.id,
    });
    assert.equal(invalid(again), "used");
    assert.equal((await approvalRow(first.id)).status, "completed");
    assert.equal(recorded.length, 1);
    assert.equal((await paymentsOf(id)).length, 1);
  });

  test("the approval is asked under the procedure's path, and each call is recorded", async () => {
    await louezDb.db
      .delete(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.storeId, STORE));
    const authorization = await key();
    const { id } = await reservation();
    const deposit = await payment(id, { type: "deposit", amount: "50.00" });
    const removable = await payment(id, { type: "damage", amount: "5.00" });
    await approved(authorization, "record_payment", {
      reservationId: id,
      type: "rental",
      amount: "10.00",
      method: "cash",
    });
    await approved(authorization, "record_deposit_return", {
      reservationId: id,
      amount: "10.00",
      method: "cash",
    });
    await approved(authorization, "delete_payment", { paymentId: removable });
    assert.ok(deposit);

    assert.deepEqual(await approvalProcedures(), [
      "dashboard.payments.delete",
      "dashboard.payments.record",
      "dashboard.payments.recordDepositReturn",
    ]);
    // One row per key-less call: the call that asked, then the one that ran.
    assert.deepEqual((await operations()).map((row) => `${row.procedure} ${row.status}`).sort(), [
      "dashboard.payments.delete failed",
      "dashboard.payments.delete succeeded",
      "dashboard.payments.record failed",
      "dashboard.payments.record succeeded",
      "dashboard.payments.recordDepositReturn failed",
      "dashboard.payments.recordDepositReturn succeeded",
    ]);
  });

  test("a key whose confirmations are off still needs the person's approval before each of the three", async () => {
    const authorization = await key(WRITE, { confirmSensitive: false });
    const { id } = await reservation();
    const deposit = await payment(id, { type: "deposit", amount: "50.00" });
    const calls: Array<[string, Json]> = [
      ["record_payment", { reservationId: id, type: "rental", amount: "80.00", method: "cash" }],
      ["record_deposit_return", { reservationId: id, amount: "50.00", method: "cash" }],
      ["delete_payment", { paymentId: deposit }],
    ];
    for (const [name, args] of calls) {
      const before = recorded.length;
      const { id: approvalId } = approval(await mcpCall(authorization, name, args));
      assert.equal(recorded.length, before, `${name} did nothing yet`);
      await approve(approvalId);
      const done = await mcpCall(authorization, name, { ...args, confirmationToken: approvalId });
      assert.notEqual(done.isError, true, textOf(done));
    }
    assert.deepEqual(
      recorded.map((row) => row.type),
      ["rental", "deposit_return"],
    );
    assert.deepEqual(
      (await paymentsOf(id)).map((row) => row.type),
      ["rental", "deposit_return"],
      "the approved deletion ran",
    );
  });

  test("record_payment's approval holds while the reservation's status and the input stay as previewed", async () => {
    const authorization = await key();
    const { id } = await reservation("pending");
    const args = { reservationId: id, type: "rental", amount: "80.00", method: "cash" };

    // Another payment recorded meanwhile: the approval still holds (only the status is bound).
    const kept = approval(await mcpCall(authorization, "record_payment", args));
    await approve(kept.id);
    await payment(id, { type: "deposit", amount: "50.00" });
    const done = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: kept.id,
    });
    assert.notEqual(done.isError, true, textOf(done));

    // The status moved: refused.
    const moved = approval(await mcpCall(authorization, "record_payment", args));
    await approve(moved.id);
    await louezDb.db
      .update(louezDb.reservations)
      .set({ status: "confirmed" })
      .where(orm.eq(louezDb.reservations.id, id));
    const late = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: moved.id,
    });
    assert.equal(invalid(late), "state_changed");

    // Another argument than the approved one: another request, which the id is not.
    const fresh = approval(await mcpCall(authorization, "record_payment", args));
    await approve(fresh.id);
    const changed = await mcpCall(authorization, "record_payment", {
      ...args,
      amount: "800.00",
      confirmationToken: fresh.id,
    });
    assert.equal(invalid(changed), "other_request");
    assert.equal((await approvalRow(fresh.id)).status, "approved", "the approval is untouched");
    assert.equal(recorded.length, 1, "only the first one ran");
  });

  test("record_deposit_return previews the returnable deposit, and its approval stops once that balance moves", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    await payment(id, { type: "deposit", amount: "50.00" });
    const args = { reservationId: id, amount: "30.00", method: "cash" };

    const first = approval(await mcpCall(authorization, "record_deposit_return", args));
    assert.deepEqual(first.preview, {
      summary: `Record a deposit return of CHF\u00a030.00 (cash) on reservation #${number}.`,
      details: {
        sensitive: "money",
        reservationId: id,
        number,
        amount: "30.00",
        method: "cash",
        returnable: "50.00",
      },
    });

    // Another deposit collected meanwhile moves the balance: refused.
    await approve(first.id);
    await payment(id, { type: "deposit", amount: "10.00" });
    const late = await mcpCall(authorization, "record_deposit_return", {
      ...args,
      confirmationToken: first.id,
    });
    assert.equal(invalid(late), "state_changed");
    assert.deepEqual(recorded, []);

    const again = approval(await mcpCall(authorization, "record_deposit_return", args));
    assert.notEqual(again.id, first.id, "a new approval, with the balance as it is now");
    assert.equal((again.preview as { details: Json }).details.returnable, "60.00");
    await approve(again.id);
    const done = await mcpCall(authorization, "record_deposit_return", {
      ...args,
      confirmationToken: again.id,
    });
    assert.deepEqual(answer(done), {
      reservationId: id,
      number,
      amount: "30.00",
      method: "cash",
      links: { dashboard: link(id) },
    });
    assert.deepEqual(recorded.map(withoutDate), [
      {
        reservationId: id,
        storeId: STORE,
        facts: { currency: "CHF", grossMinor: null, insuranceShareMinor: 0 },
        type: "deposit_return",
        method: "cash",
        amount: "30.00",
        origin: "deposit",
        notes: null,
      },
    ]);
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 1 }]);
    assert.deepEqual(await historyOf(id), [], "no history line");
  });

  test("delete_payment previews the row, binds its amount and status, and deletes it with the billing mark", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    const damage = await payment(id, { type: "damage", amount: "15.00" }, "card");
    const args = { paymentId: damage };

    const first = approval(await mcpCall(authorization, "delete_payment", args));
    assert.deepEqual(first.preview, {
      summary: `Delete the damage payment of €15.00 (card) on reservation #${number}.`,
      details: {
        sensitive: "destructive",
        paymentId: damage,
        number,
        type: "damage",
        amount: "15.00",
        method: "card",
      },
    });
    assert.equal((await paymentsOf(id)).length, 1, "the payment is still there");

    // The row's amount changed meanwhile: refused.
    await approve(first.id);
    await louezDb.db
      .update(louezDb.payments)
      .set({ amount: "16.00" })
      .where(orm.eq(louezDb.payments.id, damage));
    const amountMoved = await mcpCall(authorization, "delete_payment", {
      ...args,
      confirmationToken: first.id,
    });
    // The amount is part of what the person approved (the request's identity):
    // another amount is another request, which this approval is not.
    assert.equal(invalid(amountMoved), "other_request");

    // Its status changed meanwhile: refused.
    const second = approval(await mcpCall(authorization, "delete_payment", args));
    await approve(second.id);
    await louezDb.db
      .update(louezDb.payments)
      .set({ status: "pending" })
      .where(orm.eq(louezDb.payments.id, damage));
    const statusMoved = await mcpCall(authorization, "delete_payment", {
      ...args,
      confirmationToken: second.id,
    });
    assert.equal(invalid(statusMoved), "state_changed");
    assert.equal((await paymentsOf(id)).length, 1);
    assert.deepEqual(await marks(), []);

    const done = await approved(authorization, "delete_payment", args);
    assert.deepEqual(answer(done), {
      paymentId: damage,
      reservationId: id,
      number,
      links: { dashboard: link(id) },
    });
    assert.deepEqual(await paymentsOf(id), []);
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 1 }]);
    assert.deepEqual(await historyOf(id), [], "no history line");
  });

  test("a reservation or a payment the store does not have is not found, and nothing is asked", async () => {
    const authorization = await key();
    const elsewhere = await reservation("confirmed", OTHER_STORE);
    const elsewherePayment = await payment(elsewhere.id, { type: "rental", amount: "20.00" });
    const asked = await approvalCount();

    for (const reservationId of [elsewhere.id, "pw_res_nowhere"]) {
      assert.deepEqual(
        refusal(
          await mcpCall(authorization, "record_payment", {
            reservationId,
            type: "rental",
            amount: "80.00",
            method: "cash",
          }),
        ),
        { code: "RESERVATION_NOT_FOUND", message: "Reservation not found.", retryable: false },
      );
      assert.deepEqual(
        refusal(
          await mcpCall(authorization, "record_deposit_return", {
            reservationId,
            amount: "10.00",
            method: "cash",
          }),
        ),
        { code: "RESERVATION_NOT_FOUND", message: "Reservation not found.", retryable: false },
      );
    }
    for (const paymentId of [elsewherePayment, "pw_pay_nowhere"]) {
      assert.deepEqual(refusal(await mcpCall(authorization, "delete_payment", { paymentId })), {
        code: "PAYMENT_NOT_FOUND",
        message: "Payment not found.",
        retryable: false,
      });
    }
    assert.deepEqual(recorded, []);
    assert.equal((await paymentsOf(elsewhere.id)).length, 1);
    assert.equal(await approvalCount(), asked, "nothing was asked");
  });

  test("each refusal comes before anything is asked, with its message, and writes nothing", async () => {
    const authorization = await key();
    const open = await reservation();
    const cancelled = await reservation("cancelled");
    const rejected = await reservation("rejected");
    await payment(open.id, { type: "deposit", amount: "50.00" });
    await payment(open.id, { type: "deposit_return", amount: "20.00" });
    const charged = await payment(open.id, { type: "rental", amount: "80.00" }, "stripe");
    const before = await paymentsOf(open.id);

    const refused = (code: string, message: string) => ({ code, message, retryable: false });
    const previews = await approvalCount();
    // Refused whatever the user would answer: refused at once, nothing asked.
    const record = (reservationId: string, type: string, amount: string) =>
      mcpCall(authorization, "record_payment", { reservationId, type, amount, method: "cash" });

    assert.deepEqual(
      refusal(await record(open.id, "rental", "0")),
      refused(
        "PAYMENT_AMOUNT_INVALID",
        'Amount must be a plain decimal, not zero, with at most 8 digits before the point and 2 after (such as "150" or "-20.50").',
      ),
    );
    assert.deepEqual(
      refusal(await record(open.id, "rental", "abc")),
      refused(
        "PAYMENT_AMOUNT_INVALID",
        'Amount must be a plain decimal, not zero, with at most 8 digits before the point and 2 after (such as "150" or "-20.50").',
      ),
    );
    // An amount is a plain decimal of at most two decimals, as its row holds it.
    for (const amount of ["1e2", "+5", " 5", "5.", ".5", "12abc", "0.000", "100000000"]) {
      assert.deepEqual(
        refusal(await record(open.id, "adjustment", amount)),
        refused(
          "PAYMENT_AMOUNT_INVALID",
          'Amount must be a plain decimal, not zero, with at most 8 digits before the point and 2 after (such as "150" or "-20.50").',
        ),
        JSON.stringify(amount),
      );
    }
    // A plain decimal with too many decimals is refused for them: its
    // message and details name the currency's.
    for (const amount of ["0.004", "1.234", "-19.999"]) {
      const result = await record(open.id, "adjustment", amount);
      assert.deepEqual(
        { ...refusal(result), details: errorOf(result)?.details },
        {
          ...refused("PAYMENT_AMOUNT_INVALID", "A CHF amount has at most 2 decimals."),
          details: { currency: "CHF", decimals: 2 },
        },
        amount,
      );
    }
    assert.deepEqual(
      refusal(await record(open.id, "rental", "-5.00")),
      refused(
        "PAYMENT_NEGATIVE_AMOUNT_NOT_ADJUSTMENT",
        'Only "adjustment" payments can have a negative amount.',
      ),
    );
    assert.deepEqual(
      refusal(await record(cancelled.id, "rental", "10.00")),
      refused("PAYMENT_RESERVATION_CLOSED", "Cannot record payment on a cancelled reservation."),
    );
    assert.deepEqual(
      refusal(await record(rejected.id, "deposit", "10.00")),
      refused("PAYMENT_RESERVATION_CLOSED", "Cannot record payment on a rejected reservation."),
    );

    const giveBack = (amount: string) =>
      mcpCall(authorization, "record_deposit_return", {
        reservationId: open.id,
        amount,
        method: "cash",
      });
    assert.deepEqual(
      refusal(await giveBack("0")),
      refused(
        "DEPOSIT_RETURN_AMOUNT_INVALID",
        'Amount must be a plain decimal above zero, with at most 8 digits before the point and 2 after (such as "150.00").',
      ),
    );
    assert.deepEqual(
      refusal(await giveBack("-1")),
      refused(
        "DEPOSIT_RETURN_AMOUNT_INVALID",
        'Amount must be a plain decimal above zero, with at most 8 digits before the point and 2 after (such as "150.00").',
      ),
    );
    assert.deepEqual(
      refusal(await giveBack("10.005")),
      refused("DEPOSIT_RETURN_AMOUNT_INVALID", "A CHF amount has at most 2 decimals."),
    );
    assert.deepEqual(
      refusal(await giveBack("30.01")),
      refused(
        "DEPOSIT_RETURN_EXCEEDS_BALANCE",
        "Amount exceeds returnable deposit. Collected: CHF\u00a050.00, already returned: CHF\u00a020.00, max returnable: CHF\u00a030.00.",
      ),
    );

    assert.deepEqual(
      refusal(await mcpCall(authorization, "delete_payment", { paymentId: charged })),
      refused(
        "PAYMENT_STRIPE_NOT_DELETABLE",
        "Cannot delete a Stripe payment. Refund it instead, from the reservation's payment history in Louez or with refund_payment.",
      ),
    );

    assert.equal(await approvalCount(), previews, "no approval was asked");
    assert.deepEqual(recorded, []);
    assert.deepEqual(await paymentsOf(open.id), before);
    assert.deepEqual(await paymentsOf(cancelled.id), []);
    assert.deepEqual(await marks(), []);
  });

  test("an amount has at most the decimals of the reservation's currency, and a three-decimal currency is refused, on MCP and REST, before anything is asked", async () => {
    const authorization = await key();
    const yen = await reservation("confirmed", STORE, "JPY");
    await payment(yen.id, { type: "deposit", amount: "5.00" });
    const dinars = await reservation("confirmed", STORE, "KWD");
    await payment(dinars.id, { type: "deposit", amount: "5.00" });
    const asked = await approvalCount();
    const record = (reservationId: string, amount: string) =>
      mcpCall(authorization, "record_payment", {
        reservationId,
        type: "rental",
        amount,
        method: "cash",
      });
    const giveBack = (reservationId: string, amount: string) =>
      mcpCall(authorization, "record_deposit_return", { reservationId, amount, method: "cash" });
    const rest = async (path: string, body: object) => {
      const response = await openApi("POST", path, body, { authorization });
      const data = ((await response.json()) as { data?: Json }).data ?? {};
      return { status: response.status, code: data.code, details: data.details };
    };
    const noDecimals = 'A JPY amount has no decimals: send whole units (such as "30").';

    // Half a yen: refused with the currency and its decimals, nothing asked.
    for (const [result, code] of [
      [await record(yen.id, "0.5"), "PAYMENT_AMOUNT_INVALID"],
      [await giveBack(yen.id, "0.5"), "DEPOSIT_RETURN_AMOUNT_INVALID"],
    ] as const) {
      assert.equal(result.isError, true, textOf(result));
      const error = errorOf(result);
      assert.deepEqual(
        { code: error?.code, message: error?.message, details: error?.details },
        { code, message: noDecimals, details: { currency: "JPY", decimals: 0 } },
      );
    }
    assert.deepEqual(
      await rest(`/reservations/${yen.id}/payments`, {
        type: "rental",
        amount: "0.50",
        method: "cash",
      }),
      { status: 400, code: "PAYMENT_AMOUNT_INVALID", details: { currency: "JPY", decimals: 0 } },
    );
    assert.deepEqual(
      await rest(`/reservations/${yen.id}/deposit-returns`, { amount: "0.5", method: "cash" }),
      {
        status: 400,
        code: "DEPOSIT_RETURN_AMOUNT_INVALID",
        details: { currency: "JPY", decimals: 0 },
      },
    );

    // A three-decimal currency: refused whatever the amount, nothing asked.
    for (const result of [await record(dinars.id, "1"), await giveBack(dinars.id, "1")]) {
      assert.equal(result.isError, true, textOf(result));
      const error = errorOf(result);
      assert.deepEqual(
        { code: error?.code, details: error?.details },
        { code: "PAYMENT_CURRENCY_NOT_SUPPORTED", details: { currency: "KWD" } },
      );
    }
    for (const [path, body] of [
      [`/reservations/${dinars.id}/payments`, { type: "rental", amount: "1", method: "cash" }],
      [`/reservations/${dinars.id}/deposit-returns`, { amount: "1", method: "cash" }],
    ] as const) {
      assert.deepEqual(await rest(path, body), {
        status: 409,
        code: "PAYMENT_CURRENCY_NOT_SUPPORTED",
        details: { currency: "KWD" },
      });
    }
    assert.equal(await approvalCount(), asked, "nothing is asked for a refused amount");
    assert.equal(recorded.length, 0, "nothing is written");

    // A deposit return above the balance says it in yen.
    const above = refusal(await giveBack(yen.id, "6"));
    assert.equal(above.code, "DEPOSIT_RETURN_EXCEEDS_BALANCE");
    assert.equal(
      above.message,
      "Amount exceeds returnable deposit. Collected: ¥5, already returned: ¥0, max returnable: ¥5.",
    );

    // One yen: asked, previewed in yen as the page shows it, then written.
    const one = approval(await record(yen.id, "1"));
    assert.equal(
      (one.preview as { summary: string }).summary,
      `Record a rental payment of ¥1 (cash) on reservation #${yen.number}.`,
    );
    await approve(one.id);
    answer(
      await mcpCall(authorization, "record_payment", {
        reservationId: yen.id,
        type: "rental",
        amount: "1",
        method: "cash",
        confirmationToken: one.id,
      }),
    );
    const back = approval(await giveBack(yen.id, "1"));
    assert.equal(
      (back.preview as { summary: string }).summary,
      `Record a deposit return of ¥1 (cash) on reservation #${yen.number}.`,
    );
    await approve(back.id);
    answer(
      await mcpCall(authorization, "record_deposit_return", {
        reservationId: yen.id,
        amount: "1",
        method: "cash",
        confirmationToken: back.id,
      }),
    );
    // On REST, one yen is asked too.
    assert.equal(
      (
        await rest(`/reservations/${yen.id}/payments`, {
          type: "rental",
          amount: "1",
          method: "cash",
        })
      ).code,
      "APPROVAL_REQUIRED",
    );
    assert.equal(
      (await rest(`/reservations/${yen.id}/deposit-returns`, { amount: "1", method: "cash" })).code,
      "APPROVAL_REQUIRED",
    );
    assert.deepEqual(
      recorded.map((row) => [row.type, row.amount, row.facts.currency]),
      [
        ["rental", "1", "JPY"],
        ["deposit_return", "1", "JPY"],
      ],
    );
  });

  test("the deposit still returnable is counted in the rows' hundredths: 0.30 less 0.10 leaves 0.20, and in yen whole yen", async () => {
    const authorization = await key();
    const giveBack = (reservationId: string, amount: string) =>
      mcpCall(authorization, "record_deposit_return", { reservationId, amount, method: "cash" });
    const exceeded = (result: ToolResult) => {
      const error = errorOf(result);
      assert.equal(error?.code, "DEPOSIT_RETURN_EXCEEDS_BALANCE", textOf(result));
      return { message: error?.message, details: error?.details };
    };

    const cents = await reservation();
    await payment(cents.id, { type: "deposit", amount: "0.30" });
    await payment(cents.id, { type: "deposit_return", amount: "0.10" });
    assert.deepEqual(exceeded(await giveBack(cents.id, "0.21")), {
      message:
        "Amount exceeds returnable deposit. Collected: CHF\u00a00.30, already returned: CHF\u00a00.10, max returnable: CHF\u00a00.20.",
      details: { collected: "0.30", returned: "0.10", returnable: "0.20" },
    });
    const twenty = approval(await giveBack(cents.id, "0.20"));
    assert.deepEqual(
      (twenty.preview as { details: { returnable: string } }).details.returnable,
      "0.20",
    );

    const yen = await reservation("confirmed", STORE, "JPY");
    await payment(yen.id, { type: "deposit", amount: "3.00" });
    await payment(yen.id, { type: "deposit_return", amount: "1.00" });
    assert.deepEqual(exceeded(await giveBack(yen.id, "3")), {
      message:
        "Amount exceeds returnable deposit. Collected: ¥3, already returned: ¥1, max returnable: ¥2.",
      details: { collected: "3.00", returned: "1.00", returnable: "2.00" },
    });
    approval(await giveBack(yen.id, "2"));
  });

  test("a member may record and delete; a connection that reads payments may do neither", async () => {
    const member = await key(WRITE, { userId: MEMBER });
    const { id } = await reservation();
    // The member's key: the member approves, as the user it acts for.
    const done = await approved(member, "record_payment", {
      reservationId: id,
      type: "rental",
      amount: "10.00",
      method: "card",
    }, MEMBER);
    assert.notEqual(done.isError, true, textOf(done));
    const [recordedRow] = await paymentsOf(id);
    assert.ok(recordedRow);
    // A deletion needs the member's write permission, not delete.
    const deleted = await approved(member, "delete_payment", { paymentId: recordedRow.id }, MEMBER);
    assert.notEqual(deleted.isError, true, textOf(deleted));
    assert.deepEqual(await paymentsOf(id), []);

    const reading = await key({ ...WRITE, payments: "read" });
    const kept = await payment(id, { type: "deposit", amount: "50.00" });
    const calls: Array<[string, Json]> = [
      ["record_payment", { reservationId: id, type: "rental", amount: "80.00", method: "cash" }],
      ["record_deposit_return", { reservationId: id, amount: "10.00", method: "cash" }],
      ["delete_payment", { paymentId: kept }],
    ];
    for (const [name, args] of calls) {
      assert.equal(refusal(await mcpCall(reading, name, args)).code, "PERMISSION_DENIED", name);
    }
    assert.equal((await paymentsOf(id)).length, 1);
  });

  test("without read access to reservations, the answer carries no link", async () => {
    const authorization = await key({ ...WRITE, reservations: "none" });
    const { id, number } = await reservation();
    const done = await approved(authorization, "record_payment", {
      reservationId: id,
      type: "damage",
      amount: "12.50",
      method: "check",
    });
    assert.deepEqual(answer(done), {
      reservationId: id,
      number,
      type: "damage",
      amount: "12.50",
      method: "check",
    });
  });
  test("the same idempotency key replays the payment, and another input under it is refused", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    const args = {
      reservationId: id,
      type: "rental",
      amount: "25.00",
      method: "cash",
      idempotencyKey: "pw-payment-1",
    };
    const done = await approved(authorization, "record_payment", args);
    const facts = answer(done);
    assert.equal(facts.number, number);

    // The same key and input: the stored answer, without running again.
    const replay = await mcpCall(authorization, "record_payment", args);
    assert.notEqual(replay.isError, true, textOf(replay));
    assert.deepEqual(replay.structuredContent, facts);
    assert.equal(replay._meta?.["io.louez/replayed"], true);
    assert.equal(replay._meta?.["io.louez/operationId"], done._meta?.["io.louez/operationId"]);
    assert.match(textOf(replay), /^Done earlier \(replayed\)\./);

    // The same key with another input: refused, nothing written.
    const reused = await mcpCall(authorization, "record_payment", { ...args, amount: "26.00" });
    assert.equal(refusal(reused).code, "IDEMPOTENCY_KEY_REUSED");

    assert.equal(recorded.length, 1);
    assert.deepEqual(
      (await paymentsOf(id)).map((row) => row.amount),
      ["25.00"],
    );
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 1 }]);
  });

  test("two deposit returns sent together cannot both pass the returnable balance", async () => {
    // Each within the balance alone, both over it. Each was previewed at
    // 50.00; the second to take the reservation's lock reads the balance the
    // first left, and is refused by it before its approval is read.
    const authorization = await key();
    const { id } = await reservation();
    await payment(id, { type: "deposit", amount: "50.00" });
    const thirty = { reservationId: id, amount: "30.00", method: "cash" };
    const forty = { reservationId: id, amount: "40.00", method: "card" };
    const tokens = [
      approval(await mcpCall(authorization, "record_deposit_return", thirty)).id,
      approval(await mcpCall(authorization, "record_deposit_return", forty)).id,
    ];
    for (const id of tokens) await approve(id);

    const results = await raceOnLockedRow(database, { table: "reservations", id }, [
      () =>
        mcpCall(authorization, "record_deposit_return", {
          ...thirty,
          confirmationToken: tokens[0],
        }),
      () =>
        mcpCall(authorization, "record_deposit_return", {
          ...forty,
          confirmationToken: tokens[1],
        }),
    ]);

    const won = results.filter((result) => result.isError !== true);
    const lost = results.filter((result) => result.isError === true);
    assert.equal(won.length, 1, results.map(textOf).join("\n---\n"));
    assert.equal(lost.length, 1);
    const [loser] = lost;
    assert.ok(loser);
    assert.equal(refusal(loser).code, "DEPOSIT_RETURN_EXCEEDS_BALANCE");
    const returns = (await paymentsOf(id)).filter((row) => row.type === "deposit_return");
    assert.equal(returns.length, 1);

    // Sent again, the other return is refused at once, with what is left.
    const left = (50 - Number(returns[0]?.amount)).toFixed(2);
    const other = returns[0]?.amount === "30.00" ? forty : thirty;
    const refused = await mcpCall(authorization, "record_deposit_return", other);
    assert.equal(refusal(refused).code, "DEPOSIT_RETURN_EXCEEDS_BALANCE");
    assert.match(refusal(refused).message ?? "", new RegExp(`max returnable: CHF\u00a0${left}\\.`));
    assert.equal((await paymentsOf(id)).filter((row) => row.type === "deposit_return").length, 1);
  });

  test("the REST API serves the three writes with a key that may write payments, each asking the person first", async () => {
    const document = await openApiDocument();
    const operation = (path: string, method: string) => {
      const entry = document.paths[path]?.[method] as
        | {
            operationId?: string;
            tags?: string[];
            responses?: Record<string, unknown>;
            parameters?: Array<{ $ref?: string; name?: string }>;
          }
        | undefined;
      assert.ok(entry, `${method.toUpperCase()} ${path} is documented`);
      return {
        operationId: entry.operationId,
        tags: entry.tags,
        forbidden: "403" in (entry.responses ?? {}),
        approval: [entry.responses?.["409"], entry.responses?.["412"], entry.responses?.["429"]],
        headers: (entry.parameters ?? []).flatMap((parameter) =>
          parameter.$ref ? [parameter.$ref.split("/").pop()] : [],
        ),
      };
    };
    const documented = (operationId: string) => ({
      operationId,
      tags: ["Payments"],
      forbidden: true,
      approval: [
        { $ref: "#/components/responses/ApprovalDeclined" },
        { $ref: "#/components/responses/ApprovalRequired" },
        { $ref: "#/components/responses/ApprovalsFull" },
      ],
      headers: ["IdempotencyKey", "LouezConfirmation"],
    });
    assert.deepEqual(
      operation("/reservations/{reservationId}/payments", "post"),
      documented("record_payment"),
    );
    assert.deepEqual(
      operation("/reservations/{reservationId}/deposit-returns", "post"),
      documented("record_deposit_return"),
    );
    assert.deepEqual(operation("/payments/{paymentId}", "delete"), documented("delete_payment"));

    const authorization = await key(WRITE, { confirmSensitive: false });
    const { id, number } = await reservation();
    const headers = { authorization };
    /** Asks, the key's owner approves, then the same request again with the approval's id. */
    const confirmedRest = async (method: string, path: string, body: object | null) => {
      const asked = await openApi(method, path, body, headers);
      assert.equal(asked.status, 412);
      const refusalBody = (await asked.json()) as {
        data: { code: string; details: { confirmationToken: string; approval: { id: string } } };
      };
      assert.equal(refusalBody.data.code, "APPROVAL_REQUIRED");
      const { id: approvalId } = refusalBody.data.details.approval;
      assert.equal(refusalBody.data.details.confirmationToken, approvalId);
      await approve(approvalId);
      const done = await openApi(method, path, body, {
        ...headers,
        "louez-confirmation": approvalId,
      });
      assert.equal(done.status, 200, await done.clone().text());
      assert.ok(done.headers.get("louez-operation-id"));
      return done.json();
    };

    assert.deepEqual(
      await confirmedRest("POST", `/reservations/${id}/payments`, {
        type: "deposit",
        amount: "50.00",
        method: "transfer",
      }),
      {
        reservationId: id,
        number,
        type: "deposit",
        amount: "50.00",
        method: "transfer",
        links: { dashboard: link(id) },
      },
    );
    assert.deepEqual(
      await confirmedRest("POST", `/reservations/${id}/deposit-returns`, {
        amount: "20.00",
        method: "cash",
      }),
      {
        reservationId: id,
        number,
        amount: "20.00",
        method: "cash",
        links: { dashboard: link(id) },
      },
    );
    const [deposit] = (await paymentsOf(id)).filter((row) => row.type === "deposit");
    assert.ok(deposit);
    assert.deepEqual(await confirmedRest("DELETE", `/payments/${deposit.id}`, null), {
      paymentId: deposit.id,
      reservationId: id,
      number,
      links: { dashboard: link(id) },
    });
    assert.deepEqual(
      (await paymentsOf(id)).map((row) => row.type),
      ["deposit_return"],
    );

    // A key that reads payments may not.
    const reading = await key({ ...WRITE, payments: "read" });
    const denied = await openApi(
      "POST",
      `/reservations/${id}/payments`,
      { type: "rental", amount: "10.00", method: "cash" },
      { authorization: reading },
    );
    assert.equal(denied.status, 403);
    assert.equal(
      ((await denied.json()) as { data: { code: string } }).data.code,
      "PERMISSION_DENIED",
    );
  });

  /** The code of a REST refusal, from its body. */
  const restCode = async (response: Response) =>
    ((await response.json()) as { data?: { code?: string } }).data?.code;

  test("on REST, a body naming another reservation than the path is refused before anything is asked", async () => {
    const authorization = await key(WRITE, { confirmSensitive: false });
    const a = await reservation();
    const b = await reservation();
    await payment(a.id, { type: "deposit", amount: "50.00" });
    await payment(b.id, { type: "deposit", amount: "50.00" });
    const asked = await approvalCount();
    const json = { authorization, "content-type": "application/json" };
    const routes: Array<[string, Json]> = [
      ["payments", { type: "rental", amount: "10.00", method: "cash" }],
      ["deposit-returns", { amount: "10.00", method: "cash" }],
    ];

    for (const [route, body] of routes) {
      const conflict = await openApiRaw(
        "POST",
        `/reservations/${a.id}/${route}`,
        JSON.stringify({ ...body, reservationId: b.id }),
        json,
      );
      assert.equal(conflict.status, 400, route);
      assert.equal(await restCode(conflict), "PATH_PARAMETER_CONFLICT", route);
    }
    assert.deepEqual(recorded, [], "nothing written");
    assert.deepEqual(
      (await paymentsOf(a.id)).map((row) => row.type),
      ["deposit"],
    );
    assert.deepEqual(
      (await paymentsOf(b.id)).map((row) => row.type),
      ["deposit"],
    );
    assert.deepEqual(await marks(), []);
    assert.equal(await approvalCount(), asked, "nothing previewed");

    // The same id repeated in the body is the path's: asked, then recorded on it.
    for (const [route, body] of routes) {
      const repeated = JSON.stringify({ ...body, reservationId: a.id });
      const first = await openApiRaw("POST", `/reservations/${a.id}/${route}`, repeated, json);
      assert.equal(first.status, 412, route);
      const token = ((await first.json()) as { data: { details: { approval: { id: string } } } })
        .data.details.approval.id;
      await approve(token);
      const done = await openApiRaw("POST", `/reservations/${a.id}/${route}`, repeated, {
        ...json,
        "louez-confirmation": token,
      });
      assert.equal(done.status, 200, await done.clone().text());
      assert.equal(((await done.json()) as { reservationId: string }).reservationId, a.id);
    }
    assert.deepEqual(
      (await paymentsOf(a.id)).map((row) => row.type),
      ["rental", "deposit", "deposit_return"],
    );
    assert.deepEqual(
      (await paymentsOf(b.id)).map((row) => row.type),
      ["deposit"],
    );
  });

  test("on REST, a body in another content type than JSON is refused, and a deletion takes none", async () => {
    const authorization = await key(WRITE, { confirmSensitive: false });
    const { id } = await reservation();
    const deposit = await payment(id, { type: "deposit", amount: "50.00" });
    const asked = await approvalCount();
    const routes: Array<[string, Json]> = [
      ["payments", { type: "rental", amount: "10.00", method: "cash" }],
      ["deposit-returns", { amount: "10.00", method: "cash" }],
    ];

    for (const [route, body] of routes) {
      for (const contentType of ["text/plain", "application/octet-stream"]) {
        const refused = await openApiRaw(
          "POST",
          `/reservations/${id}/${route}`,
          JSON.stringify(body),
          {
            authorization,
            "content-type": contentType,
          },
        );
        assert.equal(refused.status, 415, `${route}, ${contentType}`);
        assert.equal(await restCode(refused), "UNSUPPORTED_MEDIA_TYPE");
      }
    }

    // DELETE /payments/{paymentId} takes its input from its path alone.
    for (const [contentType, body] of [
      ["application/json", JSON.stringify({ paymentId: deposit })],
      ["application/json", JSON.stringify({ reason: "mistake" })],
      ["text/plain", "delete it"],
    ]) {
      const refused = await openApiRaw("DELETE", `/payments/${deposit}`, body, {
        authorization,
        "content-type": contentType,
      });
      assert.equal(refused.status, 415, `${contentType} ${body}`);
      assert.equal(await restCode(refused), "UNSUPPORTED_MEDIA_TYPE");
    }
    assert.deepEqual(recorded, [], "nothing written");
    assert.deepEqual(
      (await paymentsOf(id)).map((row) => row.type),
      ["deposit"],
    );
    assert.equal(await approvalCount(), asked, "nothing previewed");

    // Without a body, or an empty one, it goes on to its approval: the same request, one approval.
    for (const body of [null, ""]) {
      const first = await openApiRaw("DELETE", `/payments/${deposit}`, body, { authorization });
      assert.equal(first.status, 412, JSON.stringify(body));
      assert.equal(await restCode(first), "APPROVAL_REQUIRED");
    }
    assert.equal(await approvalCount(), asked + 1);
  });

  /** The id in other letters' case: MySQL still matches it. */
  const otherCase = (id: string) =>
    [...id]
      .map((char) => (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()))
      .join("");

  test("a reservation named in another case is written under its id as stored", async () => {
    const authorization = await key();
    const { id } = await reservation();
    await payment(id, { type: "deposit", amount: "50.00" });
    const sent = otherCase(id);
    assert.notEqual(sent, id);

    const paid = await approved(authorization, "record_payment", {
      reservationId: sent,
      type: "rental",
      amount: "80.00",
      method: "cash",
    });
    assert.equal(answer(paid).reservationId, id);
    const returned = await approved(authorization, "record_deposit_return", {
      reservationId: sent,
      amount: "20.00",
      method: "cash",
    });
    assert.equal(answer(returned).reservationId, id);
    assert.deepEqual(
      recorded.map((row) => row.reservationId),
      [id, id],
      "the writer is handed the stored id",
    );
    const rows = await louezDb.db
      .select({ reservationId: louezDb.payments.reservationId, type: louezDb.payments.type })
      .from(louezDb.payments)
      .where(orm.eq(louezDb.payments.reservationId, id))
      .orderBy(louezDb.payments.type);
    assert.deepEqual(rows, [
      { reservationId: id, type: "rental" },
      { reservationId: id, type: "deposit" },
      { reservationId: id, type: "deposit_return" },
    ]);
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 2 }]);
  });

  test("a payment named in another case is deleted, and its reservation marked under its id as stored", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    const damage = await payment(id, { type: "damage", amount: "15.00" });
    const sent = otherCase(damage);
    assert.notEqual(sent, damage);

    const done = await approved(authorization, "delete_payment", { paymentId: sent });
    assert.deepEqual(answer(done), {
      paymentId: damage,
      reservationId: id,
      number,
      links: { dashboard: link(id) },
    });
    assert.deepEqual(await paymentsOf(id), []);
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 1 }]);
  });

  test("a write that fails after its approval was carried out leaves it approved", async () => {
    // The approval is carried out in the write's transaction: when the write
    // rolls back, so does that, and the same approval runs it once.
    const authorization = await key();
    const { id } = await reservation();
    const args = { reservationId: id, type: "rental", amount: "15.00", method: "cash" };
    const { id: token } = approval(await mcpCall(authorization, "record_payment", args));
    await approve(token);

    failNextWrite = true;
    const failed = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: token,
    });
    assert.equal(refusal(failed).code, "INTERNAL_SERVER_ERROR");
    assert.deepEqual(await paymentsOf(id), [], "the row rolled back");
    assert.deepEqual(await marks(), [], "and its billing mark");
    assert.equal((await approvalRow(token)).status, "approved", "the approval still approved");

    const done = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: token,
    });
    assert.equal(answer(done).amount, "15.00");
    assert.equal((await paymentsOf(id)).length, 1);
  });
});

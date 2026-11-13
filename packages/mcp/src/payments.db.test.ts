import assert from "node:assert/strict";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { apiDependencyUrl } from "./testing/cjs-named-exports";
import type { McpRecordedPayment } from "./tools/payments";

mock.module(apiDependencyUrl("@louez/auth"), {
  namedExports: { auth: {}, authInstance: { api: { getSession: async () => null } } },
});

// The three payment writes as a connected assistant calls them: through the
// real MCP handler, with an API key, on a database. record_payment,
// record_deposit_return and delete_payment: what each previews and binds its
// token to, what it writes (the payment through the app's writer, in the
// tool's transaction, and the billing mark), what it leaves alone (no history
// line), each refusal with its message, and who may call them.
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
  let recorded: McpRecordedPayment[] = [];

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
  };

  /**
   * A stand-in for the app's writer: it notes the payment it is handed, then
   * writes the row and the reservation's billing mark with the caller's
   * transaction, as the real one does.
   */
  const insertRecordedPayment = async (
    tx: import("@louez/db").Transaction,
    payment: McpRecordedPayment,
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

    const httpOptions = {
      ports,
      procedures: exposure.procedures,
      deps: { insertRecordedPayment },
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
              details?: { confirmationToken?: string; preview?: unknown };
            };
          }
        | undefined
    )?.error;

  const textOf = (result: ToolResult) =>
    (result.content as Array<{ type: string; text?: string }>)
      .map((block) => block.text ?? "")
      .join("\n");

  /** The preview and the token of a call that asks for its confirmation. */
  function confirmation(result: ToolResult) {
    assert.equal(result.isError, true, textOf(result));
    const error = errorOf(result);
    assert.equal(error?.code, "CONFIRMATION_REQUIRED", textOf(result));
    const token = error?.details?.confirmationToken;
    assert.ok(token);
    return { preview: error?.details?.preview, token };
  }

  /** Asks, then calls again with the token it got. */
  async function confirmed(authorization: string, name: string, args: Json) {
    const { token } = confirmation(await mcpCall(authorization, name, args));
    return mcpCall(authorization, name, { ...args, confirmationToken: token });
  }

  /**
   * A refusal's facts. The second commit gives each its domain's code in
   * place of REQUEST_REFUSED and NOT_FOUND; the messages stay.
   */
  function refusal(result: ToolResult) {
    assert.equal(result.isError, true, textOf(result));
    const error = errorOf(result);
    return { code: error?.code, message: error?.message, retryable: error?.retryable };
  }

  const withoutDate = ({ paidAt, ...rest }: McpRecordedPayment) => {
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

  const confirmationCount = async () =>
    (
      await louezDb.db
        .select({ id: louezDb.apiConfirmations.id })
        .from(louezDb.apiConfirmations)
        .where(orm.eq(louezDb.apiConfirmations.storeId, STORE))
    ).length;

  /** The procedures the confirmations of the store were asked under. */
  const confirmationProcedures = async () =>
    (
      await louezDb.db
        .selectDistinct({ procedure: louezDb.apiConfirmations.procedure })
        .from(louezDb.apiConfirmations)
        .where(orm.eq(louezDb.apiConfirmations.storeId, STORE))
    )
      .map((row) => row.procedure)
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
        // The second commit adds idempotencyKey to each.
        arguments: Object.keys(tool.inputSchema.properties ?? {}).sort(),
        required: [...((tool.inputSchema.required as string[] | undefined) ?? [])].sort(),
      };
    };
    const additive = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    assert.deepEqual(shape("record_payment"), {
      title: "Record Payment",
      annotations: additive,
      arguments: ["amount", "confirmationToken", "method", "notes", "reservationId", "type"],
      required: ["amount", "method", "reservationId", "type"],
    });
    assert.deepEqual(shape("record_deposit_return"), {
      title: "Record Deposit Return",
      annotations: additive,
      arguments: ["amount", "confirmationToken", "method", "notes", "reservationId"],
      required: ["amount", "method", "reservationId"],
    });
    assert.deepEqual(shape("delete_payment"), {
      title: "Delete Payment",
      annotations: { ...additive, destructiveHint: true },
      arguments: ["confirmationToken", "paymentId"],
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

  test("record_payment asks first, then writes the payment once, with its billing mark and no history line", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    const args = {
      reservationId: id,
      type: "rental",
      amount: "80.00",
      method: "transfer",
      notes: "Paid by wire",
    };

    const first = confirmation(await mcpCall(authorization, "record_payment", args));
    assert.deepEqual(first.preview, {
      // The amount is written in euros whatever the store's currency, as today.
      summary: `Record a rental payment of €80.00 (transfer) on reservation #${number}.`,
      details: {
        sensitive: "money",
        reservationId: id,
        number,
        type: "rental",
        amount: "80.00",
        method: "transfer",
      },
    });
    assert.deepEqual(recorded, [], "nothing was done yet");
    assert.deepEqual(await paymentsOf(id), []);
    assert.deepEqual(await marks(), []);

    const done = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: first.token,
    });
    assert.notEqual(done.isError, true, textOf(done));
    // The second commit gives the same facts in the bridge's form.
    assert.equal(
      textOf(done),
      `Payment recorded for reservation #${number}.\n\n- Type: rental\n- Amount: €80.00\n- Method: transfer\n\nLinks to give the user: dashboard ${link(id)}.`,
    );
    assert.deepEqual(recorded.map(withoutDate), [
      {
        reservationId: id,
        storeId: STORE,
        storeSettings: SETTINGS,
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

    // A token works once.
    const again = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: first.token,
    });
    assert.equal(refusal(again).code, "CONFIRMATION_INVALID");
    assert.equal(recorded.length, 1);
    assert.equal((await paymentsOf(id)).length, 1);
  });

  test("the confirmation is asked under the tool's own name, and no operation is recorded", async () => {
    // The second commit asks under the router's path (a token issued before
    // the deploy answers CONFIRMATION_INVALID) and records each call in
    // api_operations.
    const authorization = await key();
    const { id } = await reservation();
    const deposit = await payment(id, { type: "deposit", amount: "50.00" });
    const removable = await payment(id, { type: "damage", amount: "5.00" });
    await confirmed(authorization, "record_payment", {
      reservationId: id,
      type: "rental",
      amount: "10.00",
      method: "cash",
    });
    await confirmed(authorization, "record_deposit_return", {
      reservationId: id,
      amount: "10.00",
      method: "cash",
    });
    await confirmed(authorization, "delete_payment", { paymentId: removable });
    assert.ok(deposit);

    assert.deepEqual(await confirmationProcedures(), [
      "mcp.delete_payment",
      "mcp.record_deposit_return",
      "mcp.record_payment",
    ]);
    assert.deepEqual(await operations(), []);
  });

  test("a key whose confirmations are off is still asked before each of the three", async () => {
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
      const { token } = confirmation(await mcpCall(authorization, name, args));
      assert.equal(recorded.length, before, `${name} did nothing yet`);
      const done = await mcpCall(authorization, name, { ...args, confirmationToken: token });
      assert.notEqual(done.isError, true, textOf(done));
    }
    assert.deepEqual(
      recorded.map((row) => row.type),
      ["rental", "deposit_return"],
    );
    assert.deepEqual(
      (await paymentsOf(id)).map((row) => row.type),
      ["rental", "deposit_return"],
      "the confirmed deletion ran",
    );
  });

  test("record_payment's token holds while the reservation's status and the input stay as previewed", async () => {
    const authorization = await key();
    const { id } = await reservation("pending");
    const args = { reservationId: id, type: "rental", amount: "80.00", method: "cash" };

    // Another payment recorded meanwhile: the token still holds (only the status is bound).
    const kept = confirmation(await mcpCall(authorization, "record_payment", args));
    await payment(id, { type: "deposit", amount: "50.00" });
    const done = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: kept.token,
    });
    assert.notEqual(done.isError, true, textOf(done));

    // The status moved: refused.
    const moved = confirmation(await mcpCall(authorization, "record_payment", args));
    await louezDb.db
      .update(louezDb.reservations)
      .set({ status: "confirmed" })
      .where(orm.eq(louezDb.reservations.id, id));
    const late = await mcpCall(authorization, "record_payment", {
      ...args,
      confirmationToken: moved.token,
    });
    assert.equal(refusal(late).code, "CONFIRMATION_INVALID");

    // Another argument than the previewed one: refused.
    const fresh = confirmation(await mcpCall(authorization, "record_payment", args));
    const changed = await mcpCall(authorization, "record_payment", {
      ...args,
      amount: "800.00",
      confirmationToken: fresh.token,
    });
    assert.equal(refusal(changed).code, "CONFIRMATION_INVALID");
    assert.equal(recorded.length, 1, "only the first one ran");
  });

  test("record_deposit_return previews the returnable deposit, and its token stops once that balance moves", async () => {
    const authorization = await key();
    const { id, number } = await reservation();
    await payment(id, { type: "deposit", amount: "50.00" });
    const args = { reservationId: id, amount: "30.00", method: "cash" };

    const first = confirmation(await mcpCall(authorization, "record_deposit_return", args));
    assert.deepEqual(first.preview, {
      summary: `Record a deposit return of €30.00 (cash) on reservation #${number}.`,
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
    await payment(id, { type: "deposit", amount: "10.00" });
    const late = await mcpCall(authorization, "record_deposit_return", {
      ...args,
      confirmationToken: first.token,
    });
    assert.equal(refusal(late).code, "CONFIRMATION_INVALID");
    assert.deepEqual(recorded, []);

    const again = confirmation(await mcpCall(authorization, "record_deposit_return", args));
    assert.equal((again.preview as { details: Json }).details.returnable, "60.00");
    const done = await mcpCall(authorization, "record_deposit_return", {
      ...args,
      confirmationToken: again.token,
    });
    assert.notEqual(done.isError, true, textOf(done));
    // The second commit gives the same facts in the bridge's form.
    assert.equal(
      textOf(done),
      `Deposit return recorded for reservation #${number}.\n- Amount: €30.00\n- Method: cash\n\nLinks to give the user: dashboard ${link(id)}.`,
    );
    assert.deepEqual(recorded.map(withoutDate), [
      {
        reservationId: id,
        storeId: STORE,
        storeSettings: SETTINGS,
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

    const first = confirmation(await mcpCall(authorization, "delete_payment", args));
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
    await louezDb.db
      .update(louezDb.payments)
      .set({ amount: "16.00" })
      .where(orm.eq(louezDb.payments.id, damage));
    const amountMoved = await mcpCall(authorization, "delete_payment", {
      ...args,
      confirmationToken: first.token,
    });
    assert.equal(refusal(amountMoved).code, "CONFIRMATION_INVALID");

    // Its status changed meanwhile: refused.
    const second = confirmation(await mcpCall(authorization, "delete_payment", args));
    await louezDb.db
      .update(louezDb.payments)
      .set({ status: "pending" })
      .where(orm.eq(louezDb.payments.id, damage));
    const statusMoved = await mcpCall(authorization, "delete_payment", {
      ...args,
      confirmationToken: second.token,
    });
    assert.equal(refusal(statusMoved).code, "CONFIRMATION_INVALID");
    assert.equal((await paymentsOf(id)).length, 1);
    assert.deepEqual(await marks(), []);

    const done = await confirmed(authorization, "delete_payment", args);
    assert.notEqual(done.isError, true, textOf(done));
    // The second commit gives the same facts in the bridge's form.
    assert.equal(
      textOf(done),
      `Payment deleted (reservation #${number}).\n\nLinks to give the user: dashboard ${link(id)}.`,
    );
    assert.deepEqual(await paymentsOf(id), []);
    assert.deepEqual(await marks(), [{ id, storeId: STORE, version: 1 }]);
    assert.deepEqual(await historyOf(id), [], "no history line");
  });

  test("a reservation or a payment the store does not have is not found, and nothing is asked", async () => {
    const authorization = await key();
    const elsewhere = await reservation("confirmed", OTHER_STORE);
    const elsewherePayment = await payment(elsewhere.id, { type: "rental", amount: "20.00" });
    const asked = await confirmationCount();

    for (const reservationId of [elsewhere.id, "pw_res_nowhere"]) {
      // The second commit answers RESERVATION_NOT_FOUND.
      assert.deepEqual(
        refusal(
          await mcpCall(authorization, "record_payment", {
            reservationId,
            type: "rental",
            amount: "80.00",
            method: "cash",
          }),
        ),
        { code: "NOT_FOUND", message: "Reservation not found.", retryable: false },
      );
      assert.deepEqual(
        refusal(
          await mcpCall(authorization, "record_deposit_return", {
            reservationId,
            amount: "10.00",
            method: "cash",
          }),
        ),
        { code: "NOT_FOUND", message: "Reservation not found.", retryable: false },
      );
    }
    for (const paymentId of [elsewherePayment, "pw_pay_nowhere"]) {
      // The second commit answers PAYMENT_NOT_FOUND.
      assert.deepEqual(refusal(await mcpCall(authorization, "delete_payment", { paymentId })), {
        code: "NOT_FOUND",
        message: "Payment not found.",
        retryable: false,
      });
    }
    assert.deepEqual(recorded, []);
    assert.equal((await paymentsOf(elsewhere.id)).length, 1);
    assert.equal(await confirmationCount(), asked, "nothing was asked");
  });

  test("each refusal comes after the confirmation, with its message, and writes nothing", async () => {
    const authorization = await key();
    const open = await reservation();
    const cancelled = await reservation("cancelled");
    const rejected = await reservation("rejected");
    await payment(open.id, { type: "deposit", amount: "50.00" });
    await payment(open.id, { type: "deposit_return", amount: "20.00" });
    const charged = await payment(open.id, { type: "rental", amount: "80.00" }, "stripe");
    const before = await paymentsOf(open.id);

    // The second commit gives each its domain's code in place of REQUEST_REFUSED.
    const refused = (message: string) => ({ code: "REQUEST_REFUSED", message, retryable: false });
    const record = (reservationId: string, type: string, amount: string) =>
      confirmed(authorization, "record_payment", { reservationId, type, amount, method: "cash" });

    assert.deepEqual(
      refusal(await record(open.id, "rental", "0")),
      refused("Amount must be a non-zero number."),
    );
    assert.deepEqual(
      refusal(await record(open.id, "rental", "abc")),
      refused("Amount must be a non-zero number."),
    );
    assert.deepEqual(
      refusal(await record(open.id, "rental", "-5.00")),
      refused('Only "adjustment" payments can have a negative amount.'),
    );
    assert.deepEqual(
      refusal(await record(cancelled.id, "rental", "10.00")),
      refused("Cannot record payment on a cancelled reservation."),
    );
    assert.deepEqual(
      refusal(await record(rejected.id, "deposit", "10.00")),
      refused("Cannot record payment on a rejected reservation."),
    );

    const giveBack = (amount: string) =>
      confirmed(authorization, "record_deposit_return", {
        reservationId: open.id,
        amount,
        method: "cash",
      });
    assert.deepEqual(refusal(await giveBack("0")), refused("Amount must be greater than zero."));
    assert.deepEqual(refusal(await giveBack("-1")), refused("Amount must be greater than zero."));
    assert.deepEqual(
      refusal(await giveBack("30.01")),
      refused(
        "Amount exceeds returnable deposit. Collected: €50.00, already returned: €20.00, max returnable: €30.00.",
      ),
    );

    assert.deepEqual(
      refusal(await confirmed(authorization, "delete_payment", { paymentId: charged })),
      refused("Cannot delete a Stripe payment. Use the Stripe dashboard for refunds."),
    );

    assert.deepEqual(recorded, []);
    assert.deepEqual(await paymentsOf(open.id), before);
    assert.deepEqual(await paymentsOf(cancelled.id), []);
    assert.deepEqual(await marks(), []);
  });

  test("a member may record and delete; a connection that reads payments may do neither", async () => {
    const member = await key(WRITE, { userId: MEMBER });
    const { id } = await reservation();
    const done = await confirmed(member, "record_payment", {
      reservationId: id,
      type: "rental",
      amount: "10.00",
      method: "card",
    });
    assert.notEqual(done.isError, true, textOf(done));
    const [recordedRow] = await paymentsOf(id);
    assert.ok(recordedRow);
    // A deletion needs the member's write permission, not delete.
    const deleted = await confirmed(member, "delete_payment", { paymentId: recordedRow.id });
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
    const done = await confirmed(authorization, "record_payment", {
      reservationId: id,
      type: "damage",
      amount: "12.50",
      method: "check",
    });
    // The second commit gives the same facts in the bridge's form, without links.
    assert.equal(
      textOf(done),
      `Payment recorded for reservation #${number}.\n\n- Type: damage\n- Amount: €12.50\n- Method: check`,
    );
  });
});

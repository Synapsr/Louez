import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";

import type { ReservationStatus } from "@louez/db";
import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";
import type { McpSessionContext } from "@louez/mcp";
import type { ReservationToolsClient } from "@louez/mcp/testing";

import type { createAITools } from "../ai/tools";
import type { StatusChangeDeps, StatusChangeFailure, StatusChangeStore } from "./status-change";

// Status changes from the assistant and MCP on a migrated database, with the real
// fee runner: they do what the dashboard does. The senders are fakes that note
// each call in order, so nothing leaves the machine.

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// date-change-request.server.ts imports "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";

const STORE = "store_status_change";
const OTHER_STORE = "store_status_other";
const USER = "user_status_change";
const CUSTOMER = "cus_status_change";
const START = new Date("2027-03-01T09:00:00.000Z");
const END = new Date("2027-03-03T09:00:00.000Z");
const BEFORE = new Date("2026-01-10T08:00:00Z");
const CONTRACT_URL = "https://shop.example.test/contract";

const permissions = {
  reservations: "write",
  products: "read",
  customers: "read",
  categories: "read",
  payments: "read",
  analytics: "read",
  settings: "read",
} as const;

const mcpCtx: McpSessionContext = {
  storeId: STORE,
  userId: USER,
  storeName: "Status store",
  apiKeyId: "key_status_change",
  permissions,
};

type StatusTool = ReturnType<typeof createAITools>["update_reservation_status"];
type StatusInput = Parameters<NonNullable<StatusTool["execute"]>>[0];

interface SenderCall {
  sender: keyof StatusChangeDeps;
  args: unknown[];
}
type CustomerNotification = Parameters<StatusChangeDeps["dispatchCustomerNotification"]>;

interface ItemFixture {
  stockKind: "consumable" | "returnable";
  /** The product's stock, when the product is new. */
  stock: number;
  quantity: number;
}

describe("assistant and MCP status changes (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let aiTools: typeof import("../ai/tools");
  let service: ReturnType<typeof import("./status-change").createReservationStatusService>;
  let mcp: ReservationToolsClient;
  let calls: SenderCall[] = [];
  let customerNotifications: CustomerNotification[] = [];
  let errors: StatusChangeFailure[] = [];
  let failTulip = false;
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("status_change");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    aiTools = await import("../ai/tools");
    const { createReservationStatusService } = await import("./status-change");
    const { runReservationEffects } = await import("../billing/reservation-effects");
    const { connectReservationTools } = await import("@louez/mcp/testing");

    const note = (sender: keyof StatusChangeDeps, args: unknown[]) => {
      calls.push({ sender, args });
    };
    service = createReservationStatusService({
      runReservationEffects: async (effects) => {
        const committedStatus = await readCommittedStatus(effects[0]?.reservationId);
        note("runReservationEffects", [{ effects, committedStatus }]);
        await runReservationEffects(effects);
      },
      createTulipContractForReservation: async (params) => {
        note("createTulipContractForReservation", [params]);
        if (failTulip) throw new Error("errors.tulipNotConfigured");
        return { contractId: "tulip_contract", created: true };
      },
      cancelTulipContractForReservation: async (params) => {
        note("cancelTulipContractForReservation", [params]);
        return { cancelled: true };
      },
      createReservationInstantAccessUrl: async (params) => {
        note("createReservationInstantAccessUrl", [params]);
        return CONTRACT_URL;
      },
      dispatchCustomerNotification: async (eventType, ctx) => {
        note("dispatchCustomerNotification", [eventType, ctx]);
        customerNotifications.push([eventType, ctx]);
        return { email: { sent: true }, sms: { sent: false } };
      },
      dispatchNotification: async (eventType, ctx) => {
        note("dispatchNotification", [eventType, ctx]);
        return {
          email: { sent: true },
          sms: { sent: false },
          discord: { sent: false },
          push: { sent: false },
        };
      },
      notifyReservationConfirmed: async (...args) => note("notifyReservationConfirmed", args),
      notifyReservationRejected: async (...args) => note("notifyReservationRejected", args),
      notifyEquipmentPickedUp: async (...args) => note("notifyEquipmentPickedUp", args),
      notifyReservationCompleted: async (...args) => note("notifyReservationCompleted", args),
      notifyReservationCancelled: async (...args) => note("notifyReservationCancelled", args),
      revalidatePath: (path) => note("revalidatePath", [path]),
      captureReservationActionSucceeded: async (event) => {
        note("captureReservationActionSucceeded", [event]);
      },
      log: { error: (event) => errors.push(event) },
    });
    mcp = await connectReservationTools(mcpCtx, {
      changeReservationStatus: service.changeAsAgent,
    });

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: USER,
      name: "Status store",
      slug: "status-store",
      email: "store@example.test",
      cgv: "Terms",
      // No rule warns about these dates.
      settings: {
        reservationMode: "request",
        currency: "EUR",
        advanceNoticeMinutes: 0,
        minRentalMinutes: 0,
        maxRentalMinutes: null,
        turnoverBufferMinutes: 0,
      },
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "customer@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await louezDb.db.insert(louezDb.subscriptions).values({
      id: "sub_status_change",
      storeId: STORE,
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1",
      freeReservationsGranted: 0,
    });
  });

  after(async () => {
    await mcp?.close();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    calls = [];
    customerNotifications = [];
    errors = [];
    failTulip = false;
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function createReservation(
    status: ReservationStatus,
    {
      storeId = STORE,
      source = "online",
      tulipContractId = null,
    }: { storeId?: string; source?: string; tulipContractId?: string | null } = {},
  ) {
    const id = nextId("res");
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: CUSTOMER,
      number: id,
      status,
      startDate: START,
      endDate: END,
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source,
      tulipContractId,
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    return id;
  }

  async function addItem(
    reservationId: string,
    { stockKind, stock, quantity }: ItemFixture,
    productId = nextId("prd"),
  ) {
    const [existing] = await louezDb.db
      .select({ id: louezDb.products.id })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    if (!existing) {
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: STORE,
        name: productId,
        price: "1.00",
        pricingMode: "day",
        stockKind,
        quantity: stock,
      });
    }
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId,
      productId,
      quantity,
      unitPrice: "5.00",
      depositPerUnit: "0.00",
      totalPrice: "10.00",
      productSnapshot: { name: "Kayak", description: null, images: [] },
    });
    return productId;
  }

  /** Runs the assistant's tool as the chat route builds it, for an owner of STORE. */
  async function askAssistant(input: StatusInput) {
    const tools = aiTools.createAITools(
      { storeId: STORE, userId: USER, storeName: "Status store", permissions },
      { changeReservationStatus: service.changeAsAgent },
    );
    const execute = tools.update_reservation_status.execute;
    assert.ok(execute, "the tool runs on the server");
    const output = await execute(input, { toolCallId: "call", messages: [] });
    if (Symbol.asyncIterator in output) throw new Error("the tool does not stream");
    return output;
  }

  const askMcp = (args: { reservationId: string; status: string; rejectionReason?: string }) =>
    mcp.call("update_reservation_status", args);

  const senders = () => calls.map(({ sender }) => sender);
  const argsOf = (sender: keyof StatusChangeDeps) =>
    calls.filter((call) => call.sender === sender).map((call) => call.args);

  /** What another connection sees, so only what is committed. */
  async function readCommittedStatus(reservationId: string | undefined) {
    if (!reservationId) return undefined;
    const connection = await database.connect();
    try {
      const [rows] = await connection.query<(RowDataPacket & { status: ReservationStatus })[]>(
        "SELECT reservation_status AS status FROM reservations WHERE id = ?",
        [reservationId],
      );
      return rows[0]?.status;
    } finally {
      await connection.end();
    }
  }

  async function readReservation(id: string) {
    const [row] = await louezDb.db
      .select({
        status: louezDb.reservations.status,
        signedAt: louezDb.reservations.signedAt,
        updatedAt: louezDb.reservations.updatedAt,
        billableAt: louezDb.reservations.billableAt,
      })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    return row;
  }

  async function readStock(productId: string) {
    const [row] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    return row?.quantity;
  }

  /** In the enum's order of types: rows written in the same second have no other order. */
  function readActivity(reservationId: string) {
    const activity = louezDb.reservationActivity;
    return louezDb.db
      .select({ type: activity.activityType, userId: activity.userId, metadata: activity.metadata })
      .from(activity)
      .where(eq(activity.reservationId, reservationId))
      .orderBy(activity.activityType);
  }

  function readFees(reservationId: string) {
    const fees = louezDb.platformFees;
    return louezDb.db
      .select({ dedupKey: fees.dedupKey, source: fees.source, status: fees.status })
      .from(fees)
      .where(eq(fees.reservationId, reservationId))
      .orderBy(fees.dedupKey);
  }

  test("the assistant's confirmation does what the dashboard's does, in its order", async () => {
    const id = await createReservation("pending");
    const productId = await addItem(id, { stockKind: "consumable", stock: 5, quantity: 2 });

    assert.deepEqual(await askAssistant({ reservationId: id, status: "confirmed" }), {
      success: true,
      number: id,
      from: "pending",
      to: "confirmed",
    });

    assert.deepEqual(senders(), [
      "runReservationEffects",
      "createTulipContractForReservation",
      "createReservationInstantAccessUrl",
      "dispatchCustomerNotification",
      "dispatchNotification",
      "notifyReservationConfirmed",
      "revalidatePath",
      "revalidatePath",
      "captureReservationActionSucceeded",
    ]);
    assert.deepEqual(argsOf("createTulipContractForReservation"), [
      [{ reservationId: id, source: "dashboard_reservation_confirmation" }],
    ]);
    assert.equal(customerNotifications.length, 1);
    const [[acceptedEvent, accepted]] = customerNotifications;
    assert.equal(acceptedEvent, "customer_request_accepted");
    assert.equal(accepted.customer.email, "customer@example.test");
    assert.equal(accepted.reservation.number, id);
    assert.deepEqual(accepted.items, [
      { name: "Kayak", quantity: 2, unitPrice: 5, totalPrice: 10 },
    ]);
    assert.equal(accepted.contractUrl, CONTRACT_URL);
    assert.match(accepted.termsUrl ?? "", /\/terms$/);
    assert.equal(accepted.paymentUrl, null);
    assert.equal(argsOf("dispatchNotification")[0]?.[0], "reservation_confirmed");
    assert.deepEqual(argsOf("notifyReservationConfirmed"), [
      [{ id: STORE, name: "Status store", slug: "status-store" }, id],
    ]);
    assert.deepEqual(argsOf("revalidatePath"), [
      ["/dashboard/reservations"],
      [`/dashboard/reservations/${id}`],
    ]);
    assert.deepEqual(argsOf("captureReservationActionSucceeded"), [
      [
        {
          distinctId: USER,
          storeId: STORE,
          reservationId: id,
          action: "accept_request",
          properties: {
            status_before: "pending",
            status_after: "confirmed",
            warning_count: 0,
            actor: "ai_chat",
            surface: "assistant",
          },
        },
      ],
    ]);

    // In the transaction: the stock, the contract, the history. After it: the fee.
    const row = await readReservation(id);
    assert.equal(row?.status, "confirmed");
    assert.ok(row?.billableAt, "billable_at is set");
    assert.deepEqual(argsOf("runReservationEffects"), [
      [
        {
          effects: [
            {
              type: "legacy_fee.record",
              storeId: STORE,
              reservationId: id,
              marketplace: false,
              at: row.billableAt,
            },
          ],
          committedStatus: "confirmed",
        },
      ],
    ]);
    assert.ok(row?.signedAt, "the contract is validated");
    assert.equal(await readStock(productId), 3);
    assert.ok(row && row.updatedAt > BEFORE, "updatedAt moves");
    const activity = await readActivity(id);
    assert.deepEqual(
      activity.map(({ type }) => type),
      ["confirmed", "modified"],
    );
    assert.deepEqual(activity[0], {
      type: "confirmed",
      userId: USER,
      metadata: { previousStatus: "pending", newStatus: "confirmed", actor: "ai_chat" },
    });
    assert.deepEqual(await readFees(id), [
      { dedupKey: `res:${id}`, source: "manual", status: "pending" },
    ]);
  });

  test("an MCP confirmation of a marketplace booking records both fees", async () => {
    const id = await createReservation("pending", { source: "marketplace" });

    assert.deepEqual(await askMcp({ reservationId: id, status: "confirmed" }), {
      text: `Reservation #${id} updated: Pending → Confirmed`,
      isError: false,
    });

    assert.deepEqual(await readFees(id), [
      { dedupKey: `mkt:${id}`, source: "marketplace_manual", status: "pending" },
      { dedupKey: `res:${id}`, source: "manual", status: "pending" },
    ]);
    assert.deepEqual(await readActivity(id).then((rows) => rows[0]), {
      type: "confirmed",
      userId: USER,
      metadata: { previousStatus: "pending", newStatus: "confirmed", actor: "mcp" },
    });
  });

  test("an MCP rejection sends the reason to the customer and notifies the store", async () => {
    const id = await createReservation("pending");

    assert.deepEqual(
      await askMcp({ reservationId: id, status: "rejected", rejectionReason: "Fully booked" }),
      { text: `Reservation #${id} updated: Pending → Rejected`, isError: false },
    );

    assert.deepEqual(senders(), [
      "runReservationEffects",
      "dispatchCustomerNotification",
      "dispatchNotification",
      "notifyReservationRejected",
      "revalidatePath",
      "revalidatePath",
      "captureReservationActionSucceeded",
    ]);
    assert.equal(customerNotifications.length, 1);
    const [[rejectedEvent, rejected]] = customerNotifications;
    assert.equal(rejectedEvent, "customer_request_rejected");
    assert.equal(rejected.reason, "Fully booked");
    assert.equal(argsOf("dispatchNotification")[0]?.[0], "reservation_rejected");
    assert.deepEqual(await readActivity(id), [
      {
        type: "rejected",
        userId: USER,
        metadata: {
          previousStatus: "pending",
          newStatus: "rejected",
          actor: "mcp",
          rejectionReason: "Fully booked",
        },
      },
    ]);
  });

  test("a cancellation works like the dashboard's cancel button", async () => {
    const id = await createReservation("pending", { tulipContractId: "tulip_to_cancel" });
    const productId = await addItem(id, { stockKind: "consumable", stock: 4, quantity: 1 });
    await askAssistant({ reservationId: id, status: "confirmed" });
    const requestId = nextId("act");
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: requestId,
      reservationId: id,
      activityType: "note_updated",
      metadata: {
        kind: "return_date_request",
        status: "pending",
        originalStartDate: START.toISOString(),
        originalEndDate: END.toISOString(),
        requestedEndDate: "2027-03-05T09:00:00.000Z",
        reason: "Longer trip",
      },
      createdAt: new Date("2026-02-01T10:00:00Z"),
    });
    calls = [];

    assert.deepEqual(
      await askMcp({ reservationId: id, status: "cancelled", rejectionReason: "Not a rejection" }),
      { text: `Reservation #${id} updated: Confirmed → Cancelled`, isError: false },
    );

    assert.deepEqual(senders(), [
      "runReservationEffects",
      "cancelTulipContractForReservation",
      "dispatchNotification",
      "notifyReservationCancelled",
      "revalidatePath",
      "revalidatePath",
      "captureReservationActionSucceeded",
    ]);
    assert.deepEqual(argsOf("cancelTulipContractForReservation"), [[{ reservationId: id }]]);
    assert.equal(argsOf("dispatchNotification")[0]?.[0], "reservation_cancelled");
    assert.deepEqual(argsOf("runReservationEffects"), [
      [
        {
          effects: [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
          committedStatus: "cancelled",
        },
      ],
    ]);
    assert.deepEqual(argsOf("captureReservationActionSucceeded")[0]?.[0], {
      distinctId: USER,
      storeId: STORE,
      reservationId: id,
      action: "cancel_reservation",
      properties: {
        status_before: "confirmed",
        status_after: "cancelled",
        actor: "mcp",
        surface: "mcp",
      },
    });

    assert.equal((await readReservation(id))?.status, "cancelled");
    assert.equal(await readStock(productId), 4, "the stock comes back");
    assert.deepEqual(await readFees(id), [
      { dedupKey: `res:${id}`, source: "manual", status: "voided" },
    ]);
    const activity = await readActivity(id);
    assert.equal(
      activity.find(({ metadata }) => metadata?.kind === "return_date_request")?.metadata?.status,
      "superseded",
    );
    assert.deepEqual(
      activity.find(({ type }) => type === "cancelled"),
      {
        type: "cancelled",
        userId: USER,
        metadata: { previousStatus: "confirmed", newStatus: "cancelled", actor: "mcp" },
      },
    );
  });

  test("a pick-up and a return notify the store", async () => {
    const id = await createReservation("confirmed");

    await askAssistant({ reservationId: id, status: "ongoing" });
    assert.deepEqual(senders(), [
      "runReservationEffects",
      "dispatchNotification",
      "notifyEquipmentPickedUp",
      "revalidatePath",
      "revalidatePath",
      "captureReservationActionSucceeded",
    ]);
    assert.equal(argsOf("dispatchNotification")[0]?.[0], "reservation_picked_up");

    calls = [];
    await askMcp({ reservationId: id, status: "completed" });
    assert.equal(argsOf("dispatchNotification")[0]?.[0], "reservation_completed");
    assert.deepEqual(argsOf("notifyReservationCompleted"), [
      [{ id: STORE, name: "Status store", slug: "status-store" }, id, 10, "EUR"],
    ]);
    assert.equal((await readReservation(id))?.status, "completed");
  });

  test("items another booking holds refuse the confirmation with a clear answer", async () => {
    const productId = nextId("prd");
    const holder = await createReservation("confirmed");
    await addItem(holder, { stockKind: "returnable", stock: 1, quantity: 1 }, productId);
    const id = await createReservation("pending");
    await addItem(id, { stockKind: "returnable", stock: 1, quantity: 1 }, productId);
    const unavailable =
      "Not confirmed: some items of this reservation are no longer available for its dates.";

    assert.deepEqual(await askAssistant({ reservationId: id, status: "confirmed" }), {
      error: unavailable,
    });
    assert.deepEqual(await askMcp({ reservationId: id, status: "confirmed" }), {
      text: unavailable,
      isError: true,
    });

    assert.deepEqual(senders(), []);
    const row = await readReservation(id);
    assert.equal(row?.status, "pending");
    assert.deepEqual(row?.updatedAt, BEFORE);
    assert.deepEqual(await readActivity(id), []);
    assert.deepEqual(await readFees(id), []);
  });

  test("missing consumable stock keeps its answer and rolls the change back", async () => {
    const id = await createReservation("pending");
    await addItem(id, { stockKind: "consumable", stock: 1, quantity: 2 });

    assert.deepEqual(await askAssistant({ reservationId: id, status: "confirmed" }), {
      error: "errors.consumableInsufficientStock",
    });
    assert.deepEqual(await askMcp({ reservationId: id, status: "confirmed" }), {
      text: "errors.consumableInsufficientStock",
      isError: true,
    });

    assert.deepEqual(senders(), []);
    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
  });

  test("a failed insurance contract is a warning, not a failure", async () => {
    const id = await createReservation("pending");
    failTulip = true;

    assert.deepEqual(await askAssistant({ reservationId: id, status: "confirmed" }), {
      success: true,
      number: id,
      from: "pending",
      to: "confirmed",
      warnings: [{ key: "errors.tulipNotConfigured" }],
    });

    assert.equal((await readReservation(id))?.status, "confirmed");
    assert.ok(senders().includes("dispatchCustomerNotification"), "the customer is still told");
    assert.equal(errors.length, 1);
    const failure = errors[0]?.reservation;
    assert.equal(failure?.event, "tulip_contract_create_failed");
    assert.equal(failure?.reservationId, id);
    assert.equal(failure?.error.message, "errors.tulipNotConfigured");
    assert.match(failure?.error.stack ?? "", /^Error: errors\.tulipNotConfigured\n\s+at /);
  });

  test("a refused change answers with the allowed statuses and does nothing", async () => {
    const completed = await createReservation("completed");
    const pending = await createReservation("pending");

    assert.deepEqual(await askAssistant({ reservationId: completed, status: "cancelled" }), {
      error: "Invalid transition: completed → cancelled. Allowed: none",
    });
    assert.deepEqual(await askMcp({ reservationId: completed, status: "confirmed" }), {
      text: "Invalid transition: completed → confirmed. Allowed: none",
      isError: true,
    });
    assert.deepEqual(await askAssistant({ reservationId: pending, status: "ongoing" }), {
      error: "Invalid transition: pending → ongoing. Allowed: confirmed, rejected, cancelled",
    });

    assert.deepEqual(senders(), []);
    for (const [id, status] of [
      [completed, "completed"],
      [pending, "pending"],
    ] as const) {
      const row = await readReservation(id);
      assert.equal(row?.status, status);
      assert.deepEqual(row?.updatedAt, BEFORE);
      assert.deepEqual(await readActivity(id), []);
    }
  });

  test("of an assistant and an MCP confirmation at once, the second is refused", async () => {
    const id = await createReservation("pending");

    const answers = await raceOnLockedRow(database, { table: "reservations", id }, [
      async () => {
        const answer = await askAssistant({ reservationId: id, status: "confirmed" });
        return "success" in answer ? "changed" : answer.error;
      },
      async () => {
        const answer = await askMcp({ reservationId: id, status: "confirmed" });
        return answer.isError ? answer.text : "changed";
      },
    ]);

    assert.deepEqual(answers.sort(), [
      "Invalid transition: confirmed → confirmed. Allowed: ongoing, cancelled",
      "changed",
    ]);
    assert.equal(customerNotifications.length, 1, "one email");
    assert.deepEqual(await readFees(id), [
      { dedupKey: `res:${id}`, source: "manual", status: "pending" },
    ]);
    const confirmations = (await readActivity(id)).filter(({ type }) => type === "confirmed");
    assert.equal(confirmations.length, 1);
  });

  test("of an assistant confirmation and an MCP rejection at once, the second is refused", async () => {
    const id = await createReservation("pending");

    // Both read "pending" before either takes the lock.
    const answers = await raceOnLockedRow(database, { table: "reservations", id }, [
      async () => {
        const answer = await askAssistant({ reservationId: id, status: "confirmed" });
        return "success" in answer ? "changed" : answer.error;
      },
      async () => {
        const answer = await askMcp({ reservationId: id, status: "rejected" });
        return answer.isError ? answer.text : "changed";
      },
    ]);

    const status = (await readReservation(id))?.status;
    assert.ok(status === "confirmed" || status === "rejected", `${status} is the winner's`);
    assert.deepEqual(answers.sort(), [
      `Not changed: the reservation became ${status} meanwhile. Read it again first.`,
      "changed",
    ]);
    assert.equal(customerNotifications.length, 1, "one email");
    const changes = (await readActivity(id)).filter(
      ({ type }) => type === "confirmed" || type === "rejected",
    );
    assert.deepEqual(
      changes.map(({ type }) => type),
      [status],
    );
  });

  test("a reservation of another store is not found", async () => {
    const id = await createReservation("pending", { storeId: OTHER_STORE });

    assert.deepEqual(await askAssistant({ reservationId: id, status: "confirmed" }), {
      error: "Reservation not found",
    });
    assert.deepEqual(await askMcp({ reservationId: id, status: "cancelled" }), {
      text: "Reservation not found.",
      isError: true,
    });
    assert.deepEqual(senders(), []);
    assert.equal((await readReservation(id))?.status, "pending");
  });

  test("on the dashboard, the outcomes its actions map and events without an actor", async () => {
    const [storeRow] = await louezDb.db
      .select()
      .from(louezDb.stores)
      .where(eq(louezDb.stores.id, STORE));
    assert.ok(storeRow);
    const store: StatusChangeStore = storeRow;
    const asStoreUser = { store, actor: "store_user", actorUserId: USER } as const;
    const pending = await createReservation("pending");
    const completed = await createReservation("completed");

    assert.deepEqual(
      await service.updateStatus({ ...asStoreUser, reservationId: pending, status: "confirmed" }),
      { ok: true, number: pending, from: "pending", to: "confirmed", warnings: [] },
    );
    assert.deepEqual(argsOf("captureReservationActionSucceeded")[0]?.[0], {
      distinctId: USER,
      storeId: STORE,
      reservationId: pending,
      action: "accept_request",
      properties: { status_before: "pending", status_after: "confirmed", warning_count: 0 },
    });

    calls = [];
    assert.deepEqual(
      await service.updateStatus({ ...asStoreUser, reservationId: completed, status: "confirmed" }),
      {
        ok: false,
        error: "refused",
        refusal: { changed: false, from: "completed", reason: "not_allowed" },
      },
    );
    assert.deepEqual(await service.cancel({ ...asStoreUser, reservationId: completed }), {
      ok: false,
      error: "refused",
      refusal: { changed: false, from: "completed", reason: "not_allowed" },
    });
    assert.deepEqual(await service.cancel({ ...asStoreUser, reservationId: "res_missing" }), {
      ok: false,
      error: "not_found",
    });
    assert.deepEqual(senders(), []);
  });
});

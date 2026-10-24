import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";
import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { McpSessionContext } from "../auth/context";

// The MCP status tool on a migrated database, called through an MCP client.
// packages/mcp cannot import the app's fee runner: a recording runner stands in
// and notes the status it can read, which shows that it runs after commit.

const STORE = "store_mcp_status";
const OTHER_STORE = "store_mcp_other";
const USER = "user_mcp_status";
const BEFORE = new Date("2026-01-10T08:00:00Z");

const ctx: McpSessionContext = {
  storeId: STORE,
  userId: USER,
  storeName: "MCP store",
  apiKeyId: "key_mcp_status",
  permissions: {
    reservations: "write",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  },
};

interface EffectRun {
  effects: ReservationBillingEffect[];
  /** The status another connection reads when the runner starts. */
  committedStatus: ReservationStatus | undefined;
}

describe("MCP status tool (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let client: Client;
  let runs: EffectRun[] = [];
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("mcp_tools");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    const { registerReservationTools } = await import("./reservations");

    // Only these tools. The full server loads @louez/api, whose named imports
    // from @louez/validations (CommonJS to Node) fail in this ESM test run.
    const server = new McpServer({ name: "louez", version: "0.0.0" });
    registerReservationTools(server, ctx, {
      runReservationEffects: async (effects) => {
        const [first] = effects;
        const [row] = first
          ? await louezDb.db
              .select({ status: louezDb.reservations.status })
              .from(louezDb.reservations)
              .where(eq(louezDb.reservations.id, first.reservationId))
          : [];
        runs.push({ effects: [...effects], committedStatus: row?.status });
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  after(async () => {
    await client?.close();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function createReservation(
    status: ReservationStatus,
    { storeId = STORE }: { storeId?: string } = {},
  ) {
    const id = `res_mcp_${++counter}`;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status,
      startDate: new Date("2026-02-01T09:00:00Z"),
      endDate: new Date("2026-02-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source: "online",
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    return id;
  }

  /** Calls the tool, and returns its text and the effects it ran. */
  async function updateStatus(args: {
    reservationId: string;
    status: string;
    rejectionReason?: string;
  }) {
    runs = [];
    const result = await client.callTool({ name: "update_reservation_status", arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((part: unknown) =>
        typeof part === "object" && part !== null && "text" in part ? String(part.text) : "",
      )
      .join("");
    return { text, isError: result.isError === true, runs };
  }

  async function readReservation(id: string) {
    const [row] = await louezDb.db
      .select({
        status: louezDb.reservations.status,
        updatedAt: louezDb.reservations.updatedAt,
        billableAt: louezDb.reservations.billableAt,
      })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    return row;
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

  test("a confirmation runs the record effect after commit and logs who confirmed", async () => {
    const id = await createReservation("pending");

    const {
      text,
      isError,
      runs: effectRuns,
    } = await updateStatus({
      reservationId: id,
      status: "confirmed",
    });

    assert.equal(isError, false);
    assert.equal(text, `Reservation #${id} updated: Pending → Confirmed`);
    const row = await readReservation(id);
    assert.equal(row?.status, "confirmed");
    assert.ok(row && row.updatedAt > BEFORE, "updatedAt moves");
    assert.ok(row?.billableAt, "billable_at is set");
    assert.deepEqual(effectRuns, [
      {
        effects: [
          {
            type: "legacy_fee.record",
            storeId: STORE,
            reservationId: id,
            marketplace: false,
            at: row?.billableAt,
          },
        ],
        committedStatus: "confirmed",
      },
    ]);
    assert.deepEqual(await readActivity(id), [
      {
        type: "confirmed",
        userId: USER,
        metadata: { previousStatus: "pending", newStatus: "confirmed", actor: "mcp" },
      },
    ]);
  });

  test("a cancellation runs the void effect and logs the change", async () => {
    const id = await createReservation("confirmed");

    const { text, runs: effectRuns } = await updateStatus({
      reservationId: id,
      status: "cancelled",
      // Kept only for a rejection.
      rejectionReason: "Not a rejection",
    });

    assert.equal(text, `Reservation #${id} updated: Confirmed → Cancelled`);
    assert.deepEqual(effectRuns, [
      {
        effects: [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
        committedStatus: "cancelled",
      },
    ]);
    assert.deepEqual(await readActivity(id), [
      {
        type: "cancelled",
        userId: USER,
        metadata: { previousStatus: "confirmed", newStatus: "cancelled", actor: "mcp" },
      },
    ]);
  });

  test("a rejection keeps its reason in the activity", async () => {
    const id = await createReservation("pending");

    const { runs: effectRuns } = await updateStatus({
      reservationId: id,
      status: "rejected",
      rejectionReason: "Fully booked",
    });

    assert.deepEqual(
      effectRuns.map((run) => run.effects.map((effect) => effect.type)),
      [["legacy_fee.void"]],
    );
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

  test("a refused change answers with the allowed statuses and writes nothing", async () => {
    const completed = await createReservation("completed");
    const pending = await createReservation("pending");

    assert.deepEqual(await updateStatus({ reservationId: completed, status: "confirmed" }), {
      text: "Invalid transition: completed → confirmed. Allowed: none",
      isError: true,
      runs: [],
    });
    assert.deepEqual(await updateStatus({ reservationId: pending, status: "ongoing" }), {
      text: "Invalid transition: pending → ongoing. Allowed: confirmed, rejected, cancelled",
      isError: true,
      runs: [],
    });

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

  test("of two confirmations at once, the second is refused under the lock", async () => {
    const id = await createReservation("pending");
    runs = [];

    const results = await raceOnLockedRow(database, { table: "reservations", id }, [
      () =>
        client.callTool({
          name: "update_reservation_status",
          arguments: { reservationId: id, status: "confirmed" },
        }),
      () =>
        client.callTool({
          name: "update_reservation_status",
          arguments: { reservationId: id, status: "confirmed" },
        }),
    ]);

    assert.deepEqual(results.map((result) => result.isError === true).sort(), [false, true]);
    assert.deepEqual(results.find((result) => result.isError)?.content, [
      {
        type: "text",
        text: "Invalid transition: confirmed → confirmed. Allowed: ongoing, cancelled",
      },
    ]);
    assert.deepEqual(
      runs.map((run) => run.effects.map((effect) => effect.type)),
      [["legacy_fee.record"]],
    );
    assert.deepEqual(
      (await readActivity(id)).map((row) => row.type),
      ["confirmed"],
    );
  });

  test("a rejection reason over the dashboard's limit is refused before the tool runs", async () => {
    const id = await createReservation("pending");

    const {
      text,
      isError,
      runs: effectRuns,
    } = await updateStatus({
      reservationId: id,
      status: "rejected",
      rejectionReason: "x".repeat(2001),
    });

    assert.equal(isError, true);
    assert.match(text, /Input validation error/);
    assert.deepEqual(effectRuns, []);
    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
  });

  test("a reservation of another store is not found", async () => {
    const id = await createReservation("pending", { storeId: OTHER_STORE });

    assert.deepEqual(await updateStatus({ reservationId: id, status: "confirmed" }), {
      text: "Reservation not found.",
      isError: true,
      runs: [],
    });
    assert.equal((await readReservation(id))?.status, "pending");
  });

  test("missing consumable stock refuses the confirmation and rolls it back", async () => {
    const id = await createReservation("pending");
    await louezDb.db.insert(louezDb.products).values({
      id: "prd_mcp_consumable",
      storeId: STORE,
      name: "Wax",
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: 1,
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: "itm_mcp_consumable",
      reservationId: id,
      productId: "prd_mcp_consumable",
      quantity: 2,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "2.00",
      productSnapshot: { name: "Wax", description: null, images: [] },
    });

    assert.deepEqual(await updateStatus({ reservationId: id, status: "confirmed" }), {
      text: "errors.consumableInsufficientStock",
      isError: true,
      runs: [],
    });
    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
  });
});

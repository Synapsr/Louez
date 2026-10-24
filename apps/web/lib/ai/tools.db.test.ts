import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ReservationStatus } from "@louez/db";
import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { createAITools } from "./tools";

// The assistant's status tool on a migrated database, with the real fee runner.
process.env.LOUEZ_BILLING = "cloud";

const STORE = "store_ai_status";
const OTHER_STORE = "store_ai_other";
const USER = "user_ai_status";
const FLAT_RATE_CENTS = 123;
const BEFORE = new Date("2026-01-10T08:00:00Z");

type StatusTool = ReturnType<typeof createAITools>["update_reservation_status"];
type StatusInput = Parameters<NonNullable<StatusTool["execute"]>>[0];

describe("assistant status tool (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let aiTools: typeof import("./tools");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("ai_tools");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    aiTools = await import("./tools");

    await louezDb.db.insert(louezDb.subscriptions).values({
      id: "sub_ai_status",
      storeId: STORE,
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: FLAT_RATE_CENTS },
      pricingVersion: "payg-ladder-v1",
      freeReservationsGranted: 0,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function createReservation(
    status: ReservationStatus,
    { storeId = STORE, source = "online" }: { storeId?: string; source?: string } = {},
  ) {
    const id = `res_ai_${++counter}`;
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
      source,
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    return id;
  }

  /** Runs the tool as the chat route builds it, for an owner of STORE. */
  async function updateStatus(input: StatusInput) {
    const tools = aiTools.createAITools({
      storeId: STORE,
      userId: USER,
      storeName: "AI store",
      permissions: {
        reservations: "write",
        products: "write",
        customers: "write",
        categories: "write",
        payments: "write",
        analytics: "read",
        settings: "write",
      },
    });
    const execute = tools.update_reservation_status.execute;
    assert.ok(execute, "the tool runs on the server");
    const output = await execute(input, { toolCallId: "call", messages: [] });
    if (Symbol.asyncIterator in output) throw new Error("the tool does not stream");
    return output;
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

  function readFees(reservationId: string) {
    const fees = louezDb.platformFees;
    return louezDb.db
      .select({ dedupKey: fees.dedupKey, source: fees.source, status: fees.status })
      .from(fees)
      .where(eq(fees.reservationId, reservationId))
      .orderBy(fees.dedupKey);
  }

  test("a confirmation records the fee, logs who confirmed and moves updatedAt", async () => {
    const online = await createReservation("pending");
    const marketplace = await createReservation("pending", { source: "marketplace" });

    assert.deepEqual(await updateStatus({ reservationId: online, status: "confirmed" }), {
      success: true,
      number: online,
      from: "pending",
      to: "confirmed",
    });
    await updateStatus({ reservationId: marketplace, status: "confirmed" });

    assert.deepEqual(await readFees(online), [
      { dedupKey: `res:${online}`, source: "manual", status: "pending" },
    ]);
    assert.deepEqual(await readFees(marketplace), [
      { dedupKey: `mkt:${marketplace}`, source: "marketplace_manual", status: "pending" },
      { dedupKey: `res:${marketplace}`, source: "manual", status: "pending" },
    ]);
    assert.deepEqual(await readActivity(online), [
      {
        type: "confirmed",
        userId: USER,
        metadata: { previousStatus: "pending", newStatus: "confirmed", actor: "ai_chat" },
      },
    ]);
    const row = await readReservation(online);
    assert.equal(row?.status, "confirmed");
    assert.ok(row && row.updatedAt > BEFORE, "updatedAt moves");
    assert.ok(row?.billableAt, "billable_at is set");
  });

  test("a cancellation voids the fee and logs the change", async () => {
    const id = await createReservation("pending");
    await updateStatus({ reservationId: id, status: "confirmed" });

    assert.deepEqual(await updateStatus({ reservationId: id, status: "cancelled" }), {
      success: true,
      number: id,
      from: "confirmed",
      to: "cancelled",
    });

    assert.deepEqual(await readFees(id), [
      { dedupKey: `res:${id}`, source: "manual", status: "voided" },
    ]);
    assert.deepEqual(await readActivity(id), [
      {
        type: "confirmed",
        userId: USER,
        metadata: { previousStatus: "pending", newStatus: "confirmed", actor: "ai_chat" },
      },
      {
        type: "cancelled",
        userId: USER,
        metadata: { previousStatus: "confirmed", newStatus: "cancelled", actor: "ai_chat" },
      },
    ]);
  });

  test("a refused change answers with the allowed statuses and writes nothing", async () => {
    const completed = await createReservation("completed");
    const pending = await createReservation("pending");

    assert.deepEqual(await updateStatus({ reservationId: completed, status: "confirmed" }), {
      error: "Invalid transition: completed → confirmed. Allowed: none",
    });
    assert.deepEqual(await updateStatus({ reservationId: pending, status: "ongoing" }), {
      error: "Invalid transition: pending → ongoing. Allowed: confirmed, rejected, cancelled",
    });

    for (const [id, status] of [
      [completed, "completed"],
      [pending, "pending"],
    ] as const) {
      const row = await readReservation(id);
      assert.equal(row?.status, status);
      assert.deepEqual(row?.updatedAt, BEFORE);
      assert.deepEqual(await readActivity(id), []);
      assert.deepEqual(await readFees(id), []);
    }
  });

  test("of two confirmations at once, the second is refused under the lock", async () => {
    const id = await createReservation("pending");

    const results = await raceOnLockedRow(database, { table: "reservations", id }, [
      () => updateStatus({ reservationId: id, status: "confirmed" }),
      () => updateStatus({ reservationId: id, status: "confirmed" }),
    ]);

    assert.equal(results.filter((result) => "success" in result).length, 1);
    assert.deepEqual(
      results.filter((result) => "error" in result),
      [{ error: "Invalid transition: confirmed → confirmed. Allowed: ongoing, cancelled" }],
    );
    assert.deepEqual(await readFees(id), [
      { dedupKey: `res:${id}`, source: "manual", status: "pending" },
    ]);
    assert.deepEqual(
      (await readActivity(id)).map((row) => row.type),
      ["confirmed"],
    );
  });

  test("a reservation of another store is not found", async () => {
    const id = await createReservation("pending", { storeId: OTHER_STORE });

    assert.deepEqual(await updateStatus({ reservationId: id, status: "confirmed" }), {
      error: "Reservation not found",
    });
    assert.equal((await readReservation(id))?.status, "pending");
  });

  test("missing consumable stock refuses the confirmation and rolls it back", async () => {
    const id = await createReservation("pending");
    await louezDb.db.insert(louezDb.products).values({
      id: "prd_ai_consumable",
      storeId: STORE,
      name: "Wax",
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: 1,
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: "itm_ai_consumable",
      reservationId: id,
      productId: "prd_ai_consumable",
      quantity: 2,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "2.00",
      productSnapshot: { name: "Wax", description: null, images: [] },
    });

    assert.deepEqual(await updateStatus({ reservationId: id, status: "confirmed" }), {
      error: "errors.consumableInsufficientStock",
    });
    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
    assert.deepEqual(await readFees(id), []);
  });
});

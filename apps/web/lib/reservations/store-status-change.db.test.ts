import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ReservationStatus } from "@louez/db";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { StoreStatusChangeInput } from "./store-status-change";

// The dashboard's status change on a migrated database: the inventory check,
// the stock, the contract, the return-date requests and the activity row, all
// in one transaction.

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

const STORE = "store_dash";
const OTHER_STORE = "store_other";
const USER = "user_dash";
const START = new Date("2026-02-01T09:00:00.000Z");
const END = new Date("2026-02-03T09:00:00.000Z");

describe("store status change (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let statusChange: typeof import("./store-status-change");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("store_status_change");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    statusChange = await import("./store-status-change");

    // The inventory check reads the store's settings.
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: USER,
      name: "Dashboard status",
      slug: "dashboard-status",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function createReservation(
    status: ReservationStatus,
    extra: { billableAt?: Date } = {},
  ): Promise<string> {
    const id = nextId("res");
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status,
      startDate: START,
      endDate: END,
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source: "manual",
      billableAt: extra.billableAt ?? null,
    });
    return id;
  }

  async function createProduct(options: { stockKind: "consumable" | "returnable"; stock: number }) {
    const id = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: STORE,
      name: id,
      price: "1.00",
      pricingMode: "day",
      stockKind: options.stockKind,
      quantity: options.stock,
    });
    return id;
  }

  async function addItem(
    reservationId: string,
    productId: string,
    { quantity, consumed = 0 }: { quantity: number; consumed?: number },
  ) {
    const id = nextId("itm");
    await louezDb.db.insert(louezDb.reservationItems).values({
      id,
      reservationId,
      productId,
      quantity,
      consumedQuantity: consumed,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "1.00",
      productSnapshot: { name: productId, description: null, images: [] },
    });
    return id;
  }

  async function readStock(productId: string, itemId: string) {
    const [product] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    const [item] = await louezDb.db
      .select({ consumed: louezDb.reservationItems.consumedQuantity })
      .from(louezDb.reservationItems)
      .where(eq(louezDb.reservationItems.id, itemId));
    return { stock: product?.quantity, consumed: item?.consumed };
  }

  async function readReservation(id: string) {
    const [row] = await louezDb.db
      .select({
        status: louezDb.reservations.status,
        signed: louezDb.reservations.signedAt,
        billableAt: louezDb.reservations.billableAt,
        withdrawnAt: louezDb.reservations.withdrawnAt,
      })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    return row && { ...row, signed: row.signed !== null };
  }

  async function readActivity(id: string) {
    return louezDb.db
      .select({
        id: louezDb.reservationActivity.id,
        type: louezDb.reservationActivity.activityType,
        userId: louezDb.reservationActivity.userId,
        metadata: louezDb.reservationActivity.metadata,
      })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id))
      .orderBy(louezDb.reservationActivity.createdAt);
  }

  type ChangeOptions = Partial<StoreStatusChangeInput> &
    Pick<StoreStatusChangeInput, "reservationId" | "to">;

  const change = (options: ChangeOptions) =>
    louezDb.db.transaction(
      (tx) =>
        statusChange.changeStoreReservationStatus(tx, {
          storeId: STORE,
          actor: "store_user",
          actorUserId: USER,
          dates: { startDate: START, endDate: END },
          ...options,
        }),
      { isolationLevel: "read committed" },
    );

  test("a confirmation consumes stock, validates the contract and logs the change", async () => {
    const id = await createReservation("pending");
    const productId = await createProduct({ stockKind: "consumable", stock: 5 });
    const itemId = await addItem(id, productId, { quantity: 2 });
    const warnings = [{ key: "warnings.minimumNotice", params: { hours: 24 } }];

    const result = await change({
      reservationId: id,
      to: "confirmed",
      expectedFrom: "pending",
      activity: { metadata: { validationWarnings: warnings, validationWarningsCount: 1 } },
    });

    assert.ok(result.changed);
    assert.equal(result.from, "pending");
    assert.deepEqual(
      result.effects.map(({ type, reservationId }) => ({ type, reservationId })),
      [{ type: "legacy_fee.record", reservationId: id }],
    );
    const row = await readReservation(id);
    assert.equal(row?.status, "confirmed");
    assert.equal(row?.signed, true);
    assert.ok(row?.billableAt);
    assert.deepEqual(await readStock(productId, itemId), { stock: 3, consumed: 2 });
    // Both rows can share a second, so they are matched by type, not by order.
    const activity = await readActivity(id);
    assert.deepEqual(activity.map(({ type }) => type).sort(), ["confirmed", "modified"]);
    const confirmation = activity.find(({ type }) => type === "confirmed");
    assert.equal(confirmation?.userId, USER);
    assert.deepEqual(confirmation?.metadata, {
      previousStatus: "pending",
      newStatus: "confirmed",
      actor: "store_user",
      validationWarnings: warnings,
      validationWarningsCount: 1,
    });
    const validation = activity.find(({ type }) => type === "modified");
    assert.equal(validation?.metadata?.kind, "automatic_contract_validation");
  });

  test("a confirmation refuses items another booking holds, and writes nothing", async () => {
    const productId = await createProduct({ stockKind: "returnable", stock: 1 });
    const holder = await createReservation("confirmed");
    await addItem(holder, productId, { quantity: 1 });
    const id = await createReservation("pending");
    await addItem(id, productId, { quantity: 1 });

    await assert.rejects(change({ reservationId: id, to: "confirmed", expectedFrom: "pending" }), {
      message: "errors.productNoLongerAvailable",
    });

    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
  });

  test("a cancellation restores stock, withdraws the rental and supersedes return-date requests", async () => {
    const id = await createReservation("confirmed", {
      billableAt: new Date("2026-01-20T10:00:00Z"),
    });
    const productId = await createProduct({ stockKind: "consumable", stock: 3 });
    const itemId = await addItem(id, productId, { quantity: 2, consumed: 2 });
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
        requestedEndDate: "2026-02-05T09:00:00.000Z",
        reason: "Longer trip",
      },
      createdAt: new Date("2026-01-25T10:00:00Z"),
    });

    const result = await change({ reservationId: id, to: "cancelled" });

    assert.ok(result.changed);
    assert.deepEqual(
      result.effects.map(({ type }) => type),
      ["legacy_fee.void"],
    );
    const row = await readReservation(id);
    assert.equal(row?.status, "cancelled");
    assert.equal(row?.signed, false, "a cancellation validates no contract");
    assert.ok(row?.withdrawnAt);
    assert.deepEqual(await readStock(productId, itemId), { stock: 5, consumed: 0 });

    const activity = await readActivity(id);
    assert.equal(activity[0]?.id, requestId);
    assert.equal(activity[0]?.metadata?.status, "superseded");
    assert.deepEqual(
      activity.slice(1).map(({ type, userId, metadata }) => ({ type, userId, metadata })),
      [
        {
          type: "cancelled",
          userId: USER,
          metadata: { previousStatus: "confirmed", newStatus: "cancelled", actor: "store_user" },
        },
      ],
    );
  });

  test("rejecting a request and declining a quote void the fee and are logged", async () => {
    const rejected = await createReservation("pending");
    const declined = await createReservation("quote");

    const rejection = await change({
      reservationId: rejected,
      to: "rejected",
      expectedFrom: "pending",
      activity: { metadata: { rejectionReason: "Closed that week" } },
    });
    const decline = await change({
      reservationId: declined,
      to: "declined",
      expectedFrom: "quote",
    });

    assert.ok(rejection.changed);
    assert.deepEqual(rejection.effects, [
      { type: "legacy_fee.void", storeId: STORE, reservationId: rejected },
    ]);
    assert.ok(decline.changed);
    assert.deepEqual(decline.effects, [
      { type: "legacy_fee.void", storeId: STORE, reservationId: declined },
    ]);
    assert.deepEqual(
      (await readActivity(rejected)).map(({ type, metadata }) => ({ type, metadata })),
      [
        {
          type: "rejected",
          metadata: {
            previousStatus: "pending",
            newStatus: "rejected",
            actor: "store_user",
            rejectionReason: "Closed that week",
          },
        },
      ],
    );
    assert.deepEqual(
      (await readActivity(declined)).map(({ type }) => type),
      ["quote_declined"],
    );
  });

  test("a stale, repeated, refused or foreign change writes nothing", async () => {
    const confirmed = await createReservation("confirmed");
    const completed = await createReservation("completed");
    const cancelled = await createReservation("cancelled");

    const refusals = [
      // The dashboard read pending, someone confirmed it meanwhile.
      {
        id: confirmed,
        options: { to: "rejected", expectedFrom: "pending" },
        reason: "unexpected_status",
      },
      { id: completed, options: { to: "cancelled" }, reason: "not_allowed" },
      { id: cancelled, options: { to: "cancelled" }, reason: "already_in_target" },
      { id: confirmed, options: { to: "cancelled", storeId: OTHER_STORE }, reason: "not_found" },
    ] satisfies Array<{ id: string; options: Partial<StoreStatusChangeInput>; reason: string }>;

    for (const { id, options, reason } of refusals) {
      const result = await change({ reservationId: id, ...options });
      assert.equal(result.changed, false);
      assert.equal(!result.changed && result.reason, reason);
    }
    for (const id of [confirmed, completed, cancelled]) {
      assert.deepEqual(await readActivity(id), []);
    }
    assert.equal((await readReservation(confirmed))?.status, "confirmed");
    assert.equal((await readReservation(confirmed))?.signed, false);
  });
});

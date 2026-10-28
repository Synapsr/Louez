import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ChangeReservationStatusInput, ReservationStatus } from "./reservation-status";
import {
  createTestDatabase,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "./testing/test-database";

// The real helpers on a migrated database: what they write, what they refuse,
// and what rolls back with the caller's transaction.

const STORE = "store_status";
const BEFORE = new Date("2026-01-10T08:00:00Z");
/**
 * A January instant with milliseconds, `minutes` after 10:00, the same instant
 * cut to seconds, and updated_at as MySQL rounds it.
 */
const moment = (minutes: number) => {
  const time = Date.parse("2026-01-15T10:00:00Z") + minutes * 60_000;
  return { now: new Date(time + 750), stored: new Date(time), updated: new Date(time + 1000) };
};

describe(
  "reservation status and insert helpers (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("./index");
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("reservation_status");
      // DATABASE_URL now points at the test database.
      louezDb = await import("./index");
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    async function createReservation(
      status: ReservationStatus,
      extra: { source?: string; billableAt?: Date } = {},
    ): Promise<string> {
      const id = nextId("res");
      // A fixture, so it may start in any status.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer",
        number: id,
        status,
        startDate: new Date("2026-02-01T09:00:00Z"),
        endDate: new Date("2026-02-03T09:00:00Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
        source: extra.source ?? "online",
        billableAt: extra.billableAt ?? null,
        createdAt: BEFORE,
        updatedAt: BEFORE,
      });
      return id;
    }

    /** A consumable product with `stock` left, and an item of `quantity` on the reservation. */
    async function addConsumable(
      reservationId: string,
      { stock, quantity, consumed = 0 }: { stock: number; quantity: number; consumed?: number },
    ) {
      const productId = nextId("prd");
      const itemId = nextId("itm");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: STORE,
        name: productId,
        price: "1.00",
        pricingMode: "day",
        stockKind: "consumable",
        quantity: stock,
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: itemId,
        reservationId,
        productId,
        quantity,
        consumedQuantity: consumed,
        unitPrice: "1.00",
        depositPerUnit: "0.00",
        totalPrice: "1.00",
        productSnapshot: { name: productId, description: null, images: [] },
      });
      return { productId, itemId };
    }

    async function readStock({ productId, itemId }: { productId: string; itemId: string }) {
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
          updatedAt: louezDb.reservations.updatedAt,
          billableAt: louezDb.reservations.billableAt,
          withdrawnAt: louezDb.reservations.withdrawnAt,
          pickedUpAt: louezDb.reservations.pickedUpAt,
          returnedAt: louezDb.reservations.returnedAt,
        })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      return row;
    }

    async function readActivity(id: string) {
      return louezDb.db
        .select({
          type: louezDb.reservationActivity.activityType,
          userId: louezDb.reservationActivity.userId,
          metadata: louezDb.reservationActivity.metadata,
          description: louezDb.reservationActivity.description,
          createdAt: louezDb.reservationActivity.createdAt,
        })
        .from(louezDb.reservationActivity)
        .where(eq(louezDb.reservationActivity.reservationId, id))
        .orderBy(louezDb.reservationActivity.createdAt);
    }

    type ChangeOptions = Partial<ChangeReservationStatusInput> &
      Pick<ChangeReservationStatusInput, "reservationId" | "to">;

    const change = (options: ChangeOptions) =>
      louezDb.db.transaction((tx) =>
        louezDb.changeReservationStatus(tx, {
          storeId: STORE,
          actor: "store_user",
          actorUserId: null,
          ...options,
        }),
      );

    test("a rental's life writes the status, updatedAt and each date once", async () => {
      const id = await createReservation("pending", { source: "marketplace" });
      const [confirm, pickup, giveBack] = [moment(0), moment(60), moment(120)];

      assert.deepEqual(await change({ reservationId: id, to: "confirmed", now: confirm.now }), {
        changed: true,
        from: "pending",
        to: "confirmed",
        effects: [
          {
            type: "legacy_fee.record",
            storeId: STORE,
            reservationId: id,
            marketplace: true,
            at: confirm.stored,
          },
        ],
      });
      assert.deepEqual(await readReservation(id), {
        status: "confirmed",
        updatedAt: confirm.updated,
        billableAt: confirm.stored,
        withdrawnAt: null,
        pickedUpAt: null,
        returnedAt: null,
      });

      const picked = await change({ reservationId: id, to: "ongoing", now: pickup.now });
      assert.deepEqual(picked, { changed: true, from: "confirmed", to: "ongoing", effects: [] });
      const returned = await change({ reservationId: id, to: "completed", now: giveBack.now });
      assert.deepEqual(returned, { changed: true, from: "ongoing", to: "completed", effects: [] });

      assert.deepEqual(await readReservation(id), {
        status: "completed",
        updatedAt: giveBack.updated,
        billableAt: confirm.stored,
        withdrawnAt: null,
        pickedUpAt: pickup.stored,
        returnedAt: giveBack.stored,
      });
      assert.deepEqual(
        (await readActivity(id)).map(({ type, metadata, createdAt }) => ({
          type,
          metadata,
          createdAt,
        })),
        [
          {
            type: "confirmed",
            metadata: { previousStatus: "pending", newStatus: "confirmed", actor: "store_user" },
            createdAt: confirm.stored,
          },
          {
            type: "picked_up",
            metadata: { previousStatus: "confirmed", newStatus: "ongoing", actor: "store_user" },
            createdAt: pickup.stored,
          },
          {
            type: "returned",
            metadata: { previousStatus: "ongoing", newStatus: "completed", actor: "store_user" },
            createdAt: giveBack.stored,
          },
        ],
      );
    });

    test("a confirmed row with no billable_at keeps it NULL when picked up", async () => {
      const id = await createReservation("confirmed");
      const pickup = moment(10);

      await change({ reservationId: id, to: "ongoing", now: pickup.now });

      const row = await readReservation(id);
      assert.equal(row?.billableAt, null);
      assert.deepEqual(row?.pickedUpAt, pickup.stored);
    });

    test("cancel, reject and decline write the status and updatedAt; withdrawn_at only when billable", async () => {
      const billableAt = moment(-60).stored;
      const cases: Array<{
        from: ReservationStatus;
        to: ReservationStatus;
        billableAt?: Date;
        withdrawn: boolean;
      }> = [
        { from: "confirmed", to: "cancelled", billableAt, withdrawn: true },
        { from: "ongoing", to: "cancelled", billableAt, withdrawn: true },
        { from: "pending", to: "cancelled", withdrawn: false },
        { from: "pending", to: "rejected", withdrawn: false },
        { from: "quote", to: "declined", withdrawn: false },
        { from: "quote", to: "cancelled", withdrawn: false },
      ];

      for (const { from, to, billableAt: initial, withdrawn } of cases) {
        const id = await createReservation(from, { billableAt: initial });
        const cancel = moment(30);

        const result = await change({ reservationId: id, to, now: cancel.now });

        assert.deepEqual(
          result,
          {
            changed: true,
            from,
            to,
            effects: [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
          },
          `${from} → ${to}`,
        );
        const row = await readReservation(id);
        assert.equal(row?.status, to, `${from} → ${to}`);
        assert.deepEqual(row?.updatedAt, cancel.updated, `${from} → ${to}`);
        assert.deepEqual(row?.billableAt, initial ?? null, `${from} → ${to}`);
        assert.deepEqual(row?.withdrawnAt, withdrawn ? cancel.stored : null, `${from} → ${to}`);
      }
    });

    test("a status change never stores updated_at at or before a rounded write just before it", async () => {
      // updated_at is the marketplace feed's cursor. Other writers send
      // milliseconds and MySQL rounds them: 10:00:00.600 is stored as 10:00:01.
      const cases = [
        { now: "2026-01-15T10:00:01.600Z", stored: "2026-01-15T10:00:02.000Z" },
        { now: "2026-01-15T10:00:00.700Z", stored: "2026-01-15T10:00:01.000Z" },
      ];
      for (const { now, stored } of cases) {
        const id = await createReservation("confirmed", { billableAt: BEFORE });
        await louezDb.db
          .update(louezDb.reservations)
          .set({ updatedAt: new Date("2026-01-15T10:00:00.600Z") })
          .where(eq(louezDb.reservations.id, id));

        await change({ reservationId: id, to: "cancelled", now: new Date(now) });

        const row = await readReservation(id);
        assert.equal(row?.updatedAt.toISOString(), stored, now);
        // The billing dates stay cut to the second.
        assert.equal(row?.withdrawnAt?.toISOString(), `${now.slice(0, 19)}.000Z`, now);
      }
    });

    test("a refused change writes nothing: no status, no activity, no stock", async () => {
      const id = await createReservation("confirmed", { billableAt: BEFORE });
      const stock = await addConsumable(id, { stock: 3, quantity: 2, consumed: 2 });
      const rowBefore = await readReservation(id);
      let hookCalls = 0;
      const beforeWrite = async () => {
        hookCalls += 1;
      };

      const refusals: Array<[ChangeOptions, unknown]> = [
        [
          { reservationId: id, to: "confirmed" },
          { changed: false, from: "confirmed", reason: "already_in_target" },
        ],
        [
          { reservationId: id, to: "cancelled", expectedFrom: "pending" },
          { changed: false, from: "confirmed", reason: "unexpected_status" },
        ],
        [
          { reservationId: id, to: "cancelled", expectedFrom: ["pending", "quote"] },
          { changed: false, from: "confirmed", reason: "unexpected_status" },
        ],
        [
          { reservationId: id, to: "completed" },
          { changed: false, from: "confirmed", reason: "not_allowed" },
        ],
        [
          { reservationId: id, to: "pending" },
          { changed: false, from: "confirmed", reason: "not_allowed" },
        ],
        [
          { reservationId: id, storeId: "store_other", to: "cancelled" },
          { changed: false, from: null, reason: "not_found" },
        ],
        [
          { reservationId: "res_missing", to: "cancelled" },
          { changed: false, from: null, reason: "not_found" },
        ],
      ];
      for (const [options, expected] of refusals) {
        assert.deepEqual(
          await change({ ...options, beforeWrite }),
          expected,
          JSON.stringify(options),
        );
      }

      assert.equal(hookCalls, 0);
      assert.deepEqual(await readReservation(id), rowBefore);
      assert.deepEqual(await readActivity(id), []);
      assert.deepEqual(await readStock(stock), { stock: 3, consumed: 2 });
    });

    test("consumable stock is consumed on confirm, restored on cancel, kept on complete", async () => {
      const cancelled = await createReservation("pending");
      const cancelledStock = await addConsumable(cancelled, { stock: 5, quantity: 2 });
      await change({ reservationId: cancelled, to: "confirmed" });
      assert.deepEqual(await readStock(cancelledStock), { stock: 3, consumed: 2 });
      await change({ reservationId: cancelled, to: "cancelled" });
      assert.deepEqual(await readStock(cancelledStock), { stock: 5, consumed: 0 });

      const completed = await createReservation("quote");
      const completedStock = await addConsumable(completed, { stock: 5, quantity: 2 });
      for (const to of ["confirmed", "ongoing", "completed"] as const) {
        await change({ reservationId: completed, to });
      }
      assert.deepEqual(await readStock(completedStock), { stock: 3, consumed: 2 });
    });

    test("a stock shortage throws and leaves the reservation pending", async () => {
      const id = await createReservation("pending");
      const stock = await addConsumable(id, { stock: 1, quantity: 4 });

      await assert.rejects(
        change({ reservationId: id, to: "confirmed" }),
        (error) =>
          error instanceof louezDb.ConsumableStockError && error.code === "INSUFFICIENT_STOCK",
      );

      const row = await readReservation(id);
      assert.equal(row?.status, "pending");
      assert.equal(row?.billableAt, null);
      assert.deepEqual(await readActivity(id), []);
      assert.deepEqual(await readStock(stock), { stock: 1, consumed: 0 });
    });

    test("the activity row has the type, metadata, user and the caller's override", async () => {
      const rejected = await createReservation("pending");
      const reject = moment(5);
      await change({
        reservationId: rejected,
        to: "rejected",
        actorUserId: "user_1",
        activity: { metadata: { rejectionReason: "Out of season" } },
        now: reject.now,
      });
      assert.deepEqual(await readActivity(rejected), [
        {
          type: "rejected",
          userId: "user_1",
          metadata: {
            previousStatus: "pending",
            newStatus: "rejected",
            actor: "store_user",
            rejectionReason: "Out of season",
          },
          description: null,
          createdAt: reject.stored,
        },
      ]);

      const accepted = await createReservation("quote");
      const accept = moment(6);
      await change({
        reservationId: accepted,
        to: "confirmed",
        actor: "customer",
        expectedFrom: "quote",
        activity: {
          type: "quote_accepted",
          metadata: { source: "quote_acceptance", actor: "customer" },
          description: "Accepted online",
        },
        now: accept.now,
      });
      assert.deepEqual(await readActivity(accepted), [
        {
          type: "quote_accepted",
          userId: null,
          metadata: {
            previousStatus: "quote",
            newStatus: "confirmed",
            actor: "customer",
            source: "quote_acceptance",
          },
          description: "Accepted online",
          createdAt: accept.stored,
        },
      ]);
    });

    test("beforeWrite runs under the lock, before any write; when it throws, nothing is written", async () => {
      const id = await createReservation("pending");
      const stock = await addConsumable(id, { stock: 5, quantity: 2 });
      const seen: unknown[] = [];

      await assert.rejects(
        change({
          reservationId: id,
          to: "confirmed",
          beforeWrite: async (tx, transition) => {
            seen.push(transition);
            const [inside] = await tx
              .select({ status: louezDb.reservations.status })
              .from(louezDb.reservations)
              .where(eq(louezDb.reservations.id, id));
            seen.push(inside?.status);

            const other = await database.connect();
            try {
              await assert.rejects(
                other.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE NOWAIT", [id]),
                { code: "ER_LOCK_NOWAIT" },
              );
            } finally {
              await other.end();
            }
            throw new Error("inventory check failed");
          },
        }),
        { message: "inventory check failed" },
      );

      assert.deepEqual(seen, [{ from: "pending", to: "confirmed" }, "pending"]);
      assert.equal((await readReservation(id))?.status, "pending");
      assert.deepEqual(await readActivity(id), []);
      assert.deepEqual(await readStock(stock), { stock: 5, consumed: 0 });
    });

    test("a caller that throws after the change rolls back the status, activity and stock", async () => {
      const id = await createReservation("pending");
      const stock = await addConsumable(id, { stock: 5, quantity: 2 });

      await assert.rejects(
        louezDb.db.transaction(async (tx) => {
          const result = await louezDb.changeReservationStatus(tx, {
            reservationId: id,
            storeId: STORE,
            to: "confirmed",
            actor: "store_user",
            actorUserId: null,
          });
          assert.equal(result.changed, true);
          throw new Error("contract validation failed");
        }),
        { message: "contract validation failed" },
      );

      assert.deepEqual(await readReservation(id), {
        status: "pending",
        updatedAt: BEFORE,
        billableAt: null,
        withdrawnAt: null,
        pickedUpAt: null,
        returnedAt: null,
      });
      assert.deepEqual(await readActivity(id), []);
      assert.deepEqual(await readStock(stock), { stock: 5, consumed: 0 });
    });

    test("insertReservation dates a confirmed insert and records it; pending and quote stay undated", async () => {
      const created = moment(200);
      const cases = [
        { status: "confirmed", source: "manual", billable: true, marketplace: false },
        { status: "confirmed", source: "marketplace", billable: true, marketplace: true },
        { status: "pending", source: "online", billable: false, marketplace: false },
        { status: "quote", source: "manual", billable: false, marketplace: false },
      ] as const;

      for (const { status, source, billable, marketplace } of cases) {
        const id = nextId("ins");
        const result = await louezDb.db.transaction((tx) =>
          louezDb.insertReservation(
            tx,
            {
              id,
              storeId: STORE,
              customerId: "customer",
              number: id,
              status,
              source,
              startDate: new Date("2026-02-01T09:00:00Z"),
              endDate: new Date("2026-02-03T09:00:00Z"),
              subtotalAmount: "10.00",
              depositAmount: "0.00",
              totalAmount: "10.00",
            },
            { now: created.now },
          ),
        );

        assert.deepEqual(
          result.effects,
          billable
            ? [
                {
                  type: "legacy_fee.record",
                  storeId: STORE,
                  reservationId: id,
                  marketplace,
                  at: created.stored,
                },
              ]
            : [],
          `${status} ${source}`,
        );
        const row = await readReservation(id);
        assert.equal(row?.status, status);
        assert.deepEqual(row?.billableAt, billable ? created.stored : null, `${status} ${source}`);
        assert.equal(row?.withdrawnAt, null);
        assert.deepEqual(await readActivity(id), []);
      }
    });
  },
);

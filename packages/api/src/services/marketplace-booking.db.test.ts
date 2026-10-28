import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { ApiServiceError } from "./errors";
import type { MarketplaceCancellationAdapter } from "./marketplace-booking";

// The marketplace cancel and expiry paths on a migrated database: what they
// write, what they leave alone, the locks they take, and the fee effects they
// hand to the runner.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const PAST = () => new Date(Date.now() - 60_000);
const FUTURE = () => new Date(Date.now() + 60 * 60_000);
const QUOTE_SECRET = "quote-secret";

/** A quote token signed as `createQuoteToken` signs it, already expired unless told. */
function signQuoteToken(storeId: string, expiresAt: Date = PAST()): string {
  const payload = {
    version: 1,
    storeId,
    startAt: "2026-02-01T09:00:00.000Z",
    endAt: "2026-02-03T09:00:00.000Z",
    locale: "en",
    expiresAt: expiresAt.toISOString(),
    currency: "EUR",
    lines: [],
    subtotal: 10,
    deposit: 0,
    total: 10,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", QUOTE_SECRET)
    .update(`louez.quote-token.v1.${encoded}`)
    .digest("hex");
  return `${encoded}.${signature}`;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe(
  "marketplace booking status changes (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let booking: typeof import("./marketplace-booking");
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("marketplace_booking");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      booking = await import("./marketplace-booking");
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    /** A store and its customer, so the booking snapshot's joins find them. */
    async function createStore() {
      // 21 characters, as a quote token's store id.
      const storeId = nextId("store").padEnd(21, "x");
      const customerId = nextId("cus");
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: storeId, userId: "user", name: storeId, slug: storeId });
      await louezDb.db.insert(louezDb.customers).values({
        id: customerId,
        storeId,
        email: `${customerId}@example.com`,
        firstName: "Ada",
        lastName: "Lovelace",
      });
      return { storeId, customerId };
    }

    /** A marketplace reservation and its booking attempt. */
    async function createBooking(
      store: { storeId: string; customerId: string },
      status: ReservationStatus,
      attempt: { status: string; expiresAt: Date; quoteTokenHash?: string },
    ): Promise<string> {
      const id = nextId("res");
      // A fixture, so it may start in any status.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: store.storeId,
        customerId: store.customerId,
        number: id,
        status,
        startDate: new Date("2026-02-01T09:00:00Z"),
        endDate: new Date("2026-02-03T09:00:00Z"),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
        source: "marketplace",
        billableAt: status === "confirmed" ? new Date("2026-01-10T08:00:00Z") : null,
      });
      await louezDb.db.insert(louezDb.marketplaceBookingAttempts).values({
        id,
        bookingAttemptId: `attempt-${id}`,
        storeId: store.storeId,
        quoteTokenHash: attempt.quoteTokenHash ?? "0".repeat(64),
        holdId: id,
        reservationId: id,
        status: attempt.status,
        expiresAt: attempt.expiresAt,
      });
      return id;
    }

    /** A consumable product with `stock` left, and an item of `quantity` already consumed. */
    async function addConsumedItem(
      storeId: string,
      reservationId: string,
      { stock, quantity }: { stock: number; quantity: number },
    ) {
      const productId = nextId("prd");
      const itemId = nextId("itm");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId,
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
        consumedQuantity: quantity,
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

    async function readBooking(id: string) {
      const [reservation] = await louezDb.db
        .select({
          status: louezDb.reservations.status,
          withdrawnAt: louezDb.reservations.withdrawnAt,
        })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      const [attempt] = await louezDb.db
        .select({ status: louezDb.marketplaceBookingAttempts.status })
        .from(louezDb.marketplaceBookingAttempts)
        .where(eq(louezDb.marketplaceBookingAttempts.reservationId, id));
      const activity = await louezDb.db
        .select({
          type: louezDb.reservationActivity.activityType,
          userId: louezDb.reservationActivity.userId,
          metadata: louezDb.reservationActivity.metadata,
        })
        .from(louezDb.reservationActivity)
        .where(eq(louezDb.reservationActivity.reservationId, id));
      return {
        status: reservation?.status,
        withdrawn: reservation?.withdrawnAt !== null,
        attempt: attempt?.status,
        activity,
      };
    }

    /**
     * A runner that keeps the effects it gets, with each reservation's status read
     * on another pooled connection: it shows the change only once committed.
     */
    function recordingRunner() {
      const runs: Array<{ effects: ReservationBillingEffect[]; committed: unknown[] }> = [];
      const run = async (effects: readonly ReservationBillingEffect[]) => {
        const committed: unknown[] = [];
        for (const effect of effects) {
          const [row] = await louezDb.db
            .select({ status: louezDb.reservations.status })
            .from(louezDb.reservations)
            .where(eq(louezDb.reservations.id, effect.reservationId));
          committed.push(row?.status);
        }
        runs.push({ effects: [...effects], committed });
      };
      return { run, runs };
    }

    const voidOf = (storeId: string, reservationId: string): ReservationBillingEffect => ({
      type: "legacy_fee.void",
      storeId,
      reservationId,
    });

    function fakeCancellationAdapter() {
      const calls: unknown[] = [];
      const runner = recordingRunner();
      const adapter: MarketplaceCancellationAdapter = {
        runReservationEffects: async (effects) => {
          calls.push(["runReservationEffects", [...effects]]);
          await runner.run(effects);
        },
        releasePendingPayments: async (params) => {
          calls.push(["releasePendingPayments", params]);
        },
        runCancellationSideEffects: async (reservationId) => {
          calls.push(["runCancellationSideEffects", reservationId]);
        },
      };
      return { adapter, calls, runs: runner.runs };
    }

    const cancel = (adapter: MarketplaceCancellationAdapter, reservationId: string) =>
      booking.cancelMarketplaceBooking({
        adapter,
        reservationId,
        getCanonicalUrl: (slug, path) => `https://louez.test/${slug}${path}`,
        mediaBaseUrl: "https://louez.test",
      });

    /** Resolves once `pending` waits for a row lock on reservations in this database. */
    async function waitForLockWait(pending: Promise<unknown>) {
      let settled = false;
      const markSettled = () => {
        settled = true;
      };
      pending.then(markSettled, markSettled);
      const connection = await database.connect();
      try {
        for (let poll = 0; poll < 250; poll += 1) {
          const [rows] = await connection.query(
            `SELECT 1 FROM performance_schema.data_locks
            WHERE OBJECT_SCHEMA = ? AND OBJECT_NAME = 'reservations' AND LOCK_STATUS = 'WAITING'
            LIMIT 1`,
            [database.name],
          );
          if (Array.isArray(rows) && rows.length > 0) return;
          if (settled) throw new Error("The call finished without waiting for the row lock");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("The call never waited for the row lock");
      } finally {
        await connection.end();
      }
    }

    test("a confirmed booking is cancelled, restocked and logged; its void runs after commit, first", async () => {
      const store = await createStore();
      const id = await createBooking(store, "confirmed", {
        status: "confirmed",
        expiresAt: PAST(),
      });
      const stock = await addConsumedItem(store.storeId, id, { stock: 3, quantity: 2 });
      const { adapter, calls, runs } = fakeCancellationAdapter();

      const snapshot = await cancel(adapter, id);

      assert.equal(snapshot.status, "cancelled");
      assert.deepEqual(await readBooking(id), {
        status: "cancelled",
        withdrawn: true,
        attempt: "cancelled",
        activity: [
          {
            type: "cancelled",
            userId: null,
            metadata: {
              previousStatus: "confirmed",
              newStatus: "cancelled",
              actor: "marketplace",
              source: "marketplace",
            },
          },
        ],
      });
      assert.deepEqual(await readStock(stock), { stock: 5, consumed: 0 });
      assert.deepEqual(calls, [
        ["runReservationEffects", [voidOf(store.storeId, id)]],
        ["releasePendingPayments", { reservationId: id, stripeAccountId: null }],
        ["runCancellationSideEffects", id],
      ]);
      assert.deepEqual(runs[0]?.committed, ["cancelled"]);
    });

    test("a pending booking is cancelled without a restock; its void reaches the adapter", async () => {
      const store = await createStore();
      const id = await createBooking(store, "pending", { status: "holding", expiresAt: FUTURE() });
      // Consumed stock on a pending booking, so a wrong restock would show.
      const stock = await addConsumedItem(store.storeId, id, { stock: 3, quantity: 2 });
      const { adapter, calls, runs } = fakeCancellationAdapter();

      const snapshot = await cancel(adapter, id);

      assert.equal(snapshot.status, "cancelled");
      assert.deepEqual(await readBooking(id), {
        status: "cancelled",
        withdrawn: false,
        attempt: "cancelled",
        activity: [
          {
            type: "cancelled",
            userId: null,
            metadata: {
              previousStatus: "pending",
              newStatus: "cancelled",
              actor: "marketplace",
              source: "marketplace",
            },
          },
        ],
      });
      assert.deepEqual(await readStock(stock), { stock: 3, consumed: 2 });
      assert.deepEqual(calls, [
        ["runReservationEffects", [voidOf(store.storeId, id)]],
        ["releasePendingPayments", { reservationId: id, stripeAccountId: null }],
        ["runCancellationSideEffects", id],
      ]);
      assert.deepEqual(runs[0]?.committed, ["cancelled"]);
    });

    test("a booking completed after the read is refused and left as it is", async () => {
      const store = await createStore();
      const id = await createBooking(store, "confirmed", {
        status: "confirmed",
        expiresAt: PAST(),
      });
      const stock = await addConsumedItem(store.storeId, id, { stock: 3, quantity: 2 });
      const { adapter, calls } = fakeCancellationAdapter();

      // The store completes the rental while the marketplace cancel waits for the row.
      const other = await database.connect();
      try {
        await other.beginTransaction();
        await other.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
        const cancelling = cancel(adapter, id);
        await waitForLockWait(cancelling);
        await other.query("UPDATE reservations SET reservation_status = 'completed' WHERE id = ?", [
          id,
        ]);
        await other.commit();

        await assert.rejects(
          cancelling,
          (error) =>
            error instanceof ApiServiceError &&
            error.code === "BAD_REQUEST" &&
            error.key === "not_cancellable",
        );
      } finally {
        await other.end();
      }

      assert.deepEqual(await readBooking(id), {
        status: "completed",
        withdrawn: false,
        attempt: "confirmed",
        activity: [],
      });
      assert.deepEqual(await readStock(stock), { stock: 3, consumed: 2 });
      assert.deepEqual(calls, []);
    });

    test("a booking deleted while the cancel waits answers not found", async () => {
      const store = await createStore();
      const id = await createBooking(store, "confirmed", {
        status: "confirmed",
        expiresAt: PAST(),
      });
      const { adapter, calls } = fakeCancellationAdapter();

      const other = await database.connect();
      try {
        await other.beginTransaction();
        await other.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
        const cancelling = cancel(adapter, id);
        await waitForLockWait(cancelling);
        await other.query("DELETE FROM reservations WHERE id = ?", [id]);
        await other.commit();

        await assert.rejects(
          cancelling,
          (error) =>
            error instanceof ApiServiceError &&
            error.code === "NOT_FOUND" &&
            error.key === "errors.reservationNotFound",
        );
      } finally {
        await other.end();
      }

      const left = await readBooking(id);
      assert.equal(left.attempt, "confirmed");
      assert.deepEqual(left.activity, []);
      assert.deepEqual(calls, []);
    });

    test("an expired attempt cancels its pending booking with a history row; a confirmed one outlives it", async () => {
      const store = await createStore();
      const pending = await createBooking(store, "pending", {
        status: "holding",
        expiresAt: PAST(),
      });
      const confirmed = await createBooking(store, "confirmed", {
        status: "checkout_pending",
        expiresAt: PAST(),
      });
      const stock = await addConsumedItem(store.storeId, confirmed, { stock: 3, quantity: 2 });
      const runner = recordingRunner();

      await booking.expireMarketplaceBookingAttempts({
        storeId: store.storeId,
        runReservationEffects: runner.run,
      });

      assert.deepEqual(await readBooking(pending), {
        status: "cancelled",
        withdrawn: false,
        attempt: "expired",
        activity: [
          {
            type: "cancelled",
            userId: null,
            metadata: {
              previousStatus: "pending",
              newStatus: "cancelled",
              actor: "system",
              reason: "expired",
              source: "marketplace",
            },
          },
        ],
      });
      const kept = await readBooking(confirmed);
      assert.equal(kept.status, "confirmed");
      assert.equal(kept.withdrawn, false);
      assert.deepEqual(kept.activity, []);
      assert.deepEqual(await readStock(stock), { stock: 3, consumed: 2 });

      const effects = runner.runs.flatMap((run) => run.effects);
      assert.deepEqual(effects, [voidOf(store.storeId, pending)]);
      const committed = runner.runs.flatMap((run) => run.committed);
      assert.deepEqual(committed, ["cancelled"]);
    });

    test("the expiry locks the reservation before the attempt, as the cancel does", async () => {
      const store = await createStore();
      const id = await createBooking(store, "pending", { status: "holding", expiresAt: PAST() });
      const runner = recordingRunner();

      // Another transaction takes the locks in the cancel's order: reservation, then attempt.
      const other = await database.connect();
      try {
        await other.beginTransaction();
        await other.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
        const expiring = booking.expireMarketplaceBookingAttempts({
          reservationId: id,
          runReservationEffects: runner.run,
        });
        await waitForLockWait(expiring);
        // Had the expiry locked the attempt first, MySQL would roll one of them back here.
        await other.query(
          "SELECT id FROM marketplace_booking_attempts WHERE reservation_id = ? FOR UPDATE",
          [id],
        );
        await other.commit();
        await expiring;
      } finally {
        await other.end();
      }

      const expired = await readBooking(id);
      assert.equal(expired.status, "cancelled");
      assert.equal(expired.attempt, "expired");
      assert.deepEqual(runner.runs, [
        { effects: [voidOf(store.storeId, id)], committed: ["cancelled"] },
      ]);
    });

    test("reading a booking runs the expiry with the caller's runner", async () => {
      const store = await createStore();
      const id = await createBooking(store, "pending", { status: "holding", expiresAt: PAST() });
      const runner = recordingRunner();

      const snapshot = await booking.getMarketplaceBooking({
        reservationId: id,
        getCanonicalUrl: (slug, path) => `https://louez.test/${slug}${path}`,
        mediaBaseUrl: "https://louez.test",
        runReservationEffects: runner.run,
      });

      assert.equal(snapshot.status, "expired");
      assert.equal((await readBooking(id)).status, "cancelled");
      assert.deepEqual(
        runner.runs.flatMap((run) => run.effects),
        [voidOf(store.storeId, id)],
      );
    });

    test("a hold replayed after its expiry cancels the booking; its void runs after commit", async () => {
      const store = await createStore();
      const quoteToken = signQuoteToken(store.storeId);
      const id = await createBooking(store, "pending", {
        status: "holding",
        expiresAt: PAST(),
        quoteTokenHash: sha256(quoteToken),
      });
      const runner = recordingRunner();

      await assert.rejects(
        booking.holdMarketplaceBooking({
          adapter: {
            createReservation: async () => {
              throw new Error("A replay creates no reservation");
            },
          },
          input: {
            quoteToken,
            bookingAttemptId: `attempt-${id}`,
            customer: { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" },
          },
          runReservationEffects: runner.run,
          secret: QUOTE_SECRET,
        }),
        (error) =>
          error instanceof ApiServiceError &&
          error.code === "BAD_REQUEST" &&
          error.key === "hold_expired",
      );

      assert.deepEqual(await readBooking(id), {
        status: "cancelled",
        withdrawn: false,
        attempt: "expired",
        activity: [
          {
            type: "cancelled",
            userId: null,
            metadata: {
              previousStatus: "pending",
              newStatus: "cancelled",
              actor: "system",
              reason: "expired",
              source: "marketplace",
            },
          },
        ],
      });
      assert.deepEqual(runner.runs, [
        { effects: [voidOf(store.storeId, id)], committed: ["cancelled"] },
      ]);
    });

    test("a hold the card gate refuses answers store_not_accepting_reservations, and leaves the attempt to retry", async () => {
      const store = await createStore();
      const quoteToken = signQuoteToken(store.storeId, FUTURE());
      const bookingAttemptId = nextId("attempt");

      await assert.rejects(
        booking.holdMarketplaceBooking({
          adapter: {
            createReservation: async () => ({
              success: false,
              error: "errors.storeNotAcceptingReservations",
            }),
          },
          input: {
            quoteToken,
            bookingAttemptId,
            customer: { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace" },
          },
          runReservationEffects: recordingRunner().run,
          secret: QUOTE_SECRET,
        }),
        (error) =>
          error instanceof ApiServiceError &&
          error.code === "BAD_REQUEST" &&
          error.key === "store_not_accepting_reservations",
      );

      const [attempt] = await louezDb.db
        .select({ status: louezDb.marketplaceBookingAttempts.status })
        .from(louezDb.marketplaceBookingAttempts)
        .where(eq(louezDb.marketplaceBookingAttempts.bookingAttemptId, bookingAttemptId));
      assert.deepEqual(attempt, { status: "creating_hold" });
    });

    test("a failed payment cancels a pending booking in checkout, and nothing else", async () => {
      const store = await createStore();
      const inCheckout = await createBooking(store, "pending", {
        status: "checkout_pending",
        expiresAt: FUTURE(),
      });
      const holding = await createBooking(store, "pending", {
        status: "holding",
        expiresAt: FUTURE(),
      });
      const paid = await createBooking(store, "confirmed", {
        status: "checkout_pending",
        expiresAt: FUTURE(),
      });
      const runner = recordingRunner();

      for (const id of [inCheckout, holding, paid]) {
        await booking.failMarketplaceBookingAttempt(id, runner.run);
      }

      assert.deepEqual(await readBooking(inCheckout), {
        status: "cancelled",
        withdrawn: false,
        attempt: "expired",
        activity: [
          {
            type: "cancelled",
            userId: null,
            metadata: {
              previousStatus: "pending",
              newStatus: "cancelled",
              actor: "system",
              reason: "expired",
              source: "marketplace",
            },
          },
        ],
      });
      assert.deepEqual(await readBooking(holding), {
        status: "pending",
        withdrawn: false,
        attempt: "holding",
        activity: [],
      });
      assert.deepEqual(await readBooking(paid), {
        status: "confirmed",
        withdrawn: false,
        attempt: "checkout_pending",
        activity: [],
      });
      assert.deepEqual(
        runner.runs.map((run) => run.effects),
        [[voidOf(store.storeId, inCheckout)], [], []],
      );
      assert.deepEqual(runner.runs[0]?.committed, ["cancelled"]);
    });
  },
);

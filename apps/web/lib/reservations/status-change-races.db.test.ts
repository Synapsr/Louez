import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import type { StoreSettings } from "@louez/types";

import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

// The store's status change (products, then the reservation) racing every
// other status writer, which all lock through the same owner entry
// (`runReservationChange` of packages/db), in the same order: none of them
// loses a deadlock, so no run starts over (the owner entry counts its
// restarts). Whichever order the database picks, each change and its effects
// happen once. Before that entry, the customer's acceptance and the paid
// confirmation locked the reservation first: the ordered races below were
// deadlocks then.
//
// A product added to a quote while its acceptance waits starts the acceptance
// over, under the new product's lock. A reservation still busy after three
// runs gets each caller's answer: RESERVATION_BUSY for the store, a retryable
// error for the customer, a throw for the payment, which keeps its claim.
//
// The same two paths, alone, when the reservation they confirm holds a unit
// that went to another booking meanwhile: neither confirms it (S4). And the
// three confirmations of a reservation holding a unit that only the turnover
// buffer around another booking reaches: each confirms it.

const directory = mkdtempSync(join(tmpdir(), "louez-status-races-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezRaceStubs;");
after(() => rmSync(directory, { recursive: true }));

// What the quote action calls besides the database: the customer's session,
// its emails and notifications, analytics, the page cache.
const STUBBED = new Set([
  "next/cache",
  "@/lib/customer-auth/session",
  "@/lib/customer-auth/instant-access",
  "@/lib/notifications/customer-dispatcher",
  "@/lib/notifications/dispatcher",
  "@/lib/product-analytics/analytics",
  "@/lib/reservations/payment-session",
  "@/lib/integrations/tulip/contracts",
]);
const quoteMessages: string[] = [];
Reflect.set(globalThis, "__louezRaceStubs", {
  revalidatePath: () => {},
  getCustomerSession: async () => ({ customerId: CUSTOMER }),
  createReservationInstantAccessUrl: async () => "https://shop.example.test/contract",
  dispatchCustomerNotification: async (event: string) => {
    quoteMessages.push(event);
    return { email: { sent: true }, sms: { sent: false } };
  },
  dispatchNotification: async () => ({}),
  captureProductServerEvent: async () => {},
  toAnalyticsAmountCents: () => 0,
  createReservationPaymentSessionForCustomer: async () => ({ success: false, error: "none" }),
  cancelTulipContractForReservation: async () => {},
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.includes("[reservationId]/actions.ts") && STUBBED.has(specifier)) {
      return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_status_races";
const STORE_SLUG = "status-races";
const OWNER = "user_status_races";
const CUSTOMER = "cus_status_races";

describe("status change races (database)", { skip: skipWithoutTestDatabase() }, () => {
  const hooks = reservationChangeTestHooks();
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let statusChange: typeof import("@louez/api/services/reservation-status");
  let payment: typeof import("./complete-checkout-payment");
  let abandoned: typeof import("./cancel-abandoned-checkout");
  let quotes: typeof import("@/app/(storefront)/[slug]/account/reservations/[reservationId]/actions");
  let dispatched: string[] = [];
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("status_races");
    louezDb = await import("@louez/db");
    payment = await import("./complete-checkout-payment");
    abandoned = await import("./cancel-abandoned-checkout");
    quotes = await import("@/app/(storefront)/[slug]/account/reservations/[reservationId]/actions");
    // packages/api is ES modules: its services need the CommonJS packages'
    // names by hand. Loaded last, as the mocks change how later modules load.
    await import("@louez/mcp/testing/cjs-named-exports");
    statusChange = await import("@louez/api/services/reservation-status");

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Races",
      slug: STORE_SLUG,
      settings: {
        reservationMode: "request",
        currency: "EUR",
        advanceNoticeMinutes: 0,
        pendingBlocksAvailability: false,
      },
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "ada@races.test",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  after(async () => {
    hooks.beforeReservationLock = null;
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    dispatched = [];
    quoteMessages.length = 0;
    hooks.restarts = 0;
    hooks.beforeReservationLock = null;
  });

  // 21 characters, as nanoid ids: the quote action checks their shape.
  const nextId = (prefix: string) =>
    `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

  /** A reservation of one consumable whose whole stock it takes once confirmed. */
  async function reservationOfLastUnit(status: "pending" | "quote" | "confirmed") {
    const productId = nextId("prd");
    const id = nextId("res");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId: STORE,
      name: productId,
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: 1,
    });
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status,
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "1.00",
      depositAmount: "0.00",
      totalAmount: "1.00",
      source: "online",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: id,
      productId,
      quantity: 1,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "1.00",
      productSnapshot: { name: productId, description: null, images: [] },
    });
    return { id, productId };
  }

  const caller = () => ({
    storeId: STORE,
    userId: OWNER,
    transport: "rpc" as const,
    customers: true,
    store: {
      id: STORE,
      name: "Races",
      slug: STORE_SLUG,
      ownerUserId: OWNER,
      settings: null,
      customerNotificationSettings: null,
    },
    ports: {
      afterCommit: () => {},
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      dispatchEffects: (ids: readonly string[]) => {
        dispatched.push(...ids);
      },
    },
  });

  /** Holds the reservation's row while both calls start, then lets them race. */
  async function raceOnReservation<T>(id: string, calls: Array<() => Promise<T>>) {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
      const running = Promise.all(calls.map((call) => call()));
      try {
        await waitForLockWaits(holder, database.name, calls.length);
      } finally {
        await holder.commit();
      }
      return await running;
    } finally {
      await holder.end();
    }
  }

  async function endState(id: string, productId: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    const [product] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    const activity = await louezDb.db
      .select({ type: louezDb.reservationActivity.activityType })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    const cancellationEffects = await louezDb.db
      .select({ id: louezDb.apiEffects.id })
      .from(louezDb.apiEffects)
      .where(
        and(
          eq(louezDb.apiEffects.storeId, STORE),
          eq(louezDb.apiEffects.type, "reservation.statusAnalytics"),
        ),
      );
    const types = activity.map((entry) => entry.type);
    return {
      status: row?.status,
      stock: product?.quantity,
      cancelled: types.filter((type) => type === "cancelled").length,
      confirmed: types.filter((type) => type === "confirmed" || type === "quote_accepted").length,
      storeEffects: cancellationEffects.length,
    };
  }

  describe("a reservation that holds a unit since given to a confirmed booking", () => {
    /**
     * Two S and two L. The reservation asks three units of any size and holds
     * the first S. It does not block yet (a quote, or a request in this store),
     * so that S went to a confirmed booking of the same dates: the stock still
     * counts enough units for both.
     */
    async function holdingContestedUnit(status: "pending" | "quote") {
      const productId = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: STORE,
        name: productId,
        price: "1.00",
        pricingMode: "day",
        trackUnits: true,
        bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
        quantity: 4,
      });
      const unitIds: string[] = [];
      for (const size of ["S", "S", "L", "L"]) {
        const unitId = nextId("unt");
        unitIds.push(unitId);
        await louezDb.db.insert(louezDb.productUnits).values({
          id: unitId,
          productId,
          identifier: `SECRET-${unitId}`,
          attributes: { size },
          combinationKey: `size:${size}`,
        });
      }
      const [contested = ""] = unitIds;
      const line = async (lineStatus: "pending" | "quote" | "confirmed", quantity: number) => {
        const id = nextId("res");
        const itemId = nextId("itm");
        // A fixture, so it may start in any status.
        await louezDb.db.insert(louezDb.reservations).values({
          id,
          storeId: STORE,
          customerId: CUSTOMER,
          number: id,
          status: lineStatus,
          startDate: new Date("2030-06-01T09:00:00Z"),
          endDate: new Date("2030-06-03T09:00:00Z"),
          subtotalAmount: "1.00",
          depositAmount: "0.00",
          totalAmount: "1.00",
          source: "online",
        });
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: itemId,
          reservationId: id,
          productId,
          quantity,
          unitPrice: "1.00",
          depositPerUnit: "0.00",
          totalPrice: "1.00",
          productSnapshot: { name: productId, description: null, images: [] },
        });
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: nextId("asg"),
          reservationItemId: itemId,
          productUnitId: contested,
          identifierSnapshot: `SECRET-${contested}`,
        });
        return id;
      };
      const id = await line(status, 3);
      await line("confirmed", 1);
      return { id, contested };
    }

    async function statusOf(id: string) {
      const [row] = await louezDb.db
        .select({ status: louezDb.reservations.status })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      return row?.status;
    }

    test("is not confirmed by the customer's acceptance, which names no unit", async () => {
      const { id } = await holdingContestedUnit("quote");

      const result = await quotes.acceptQuote(STORE_SLUG, id);

      // The customer reads the stock refusal: which units, only the store is told.
      assert.deepEqual(result, { error: "errors.productNoLongerAvailable" });
      assert.ok(!JSON.stringify(result).includes("SECRET"));
      assert.equal(await statusOf(id), "quote");
      assert.equal(quoteMessages.length, 0);
    });

    test("is not confirmed by its payment, and stays for the store to sort out", async () => {
      const { id, contested } = await holdingContestedUnit("pending");

      await assert.rejects(
        payment.confirmPaidReservationOrThrow({
          reservationId: id,
          storeId: STORE,
          stripeCustomerId: null,
          stripePaymentMethodId: null,
          depositStatus: "none",
          activityMetadata: { source: "unit conflict" },
        }),
        (error: Error & { conflicts?: Array<{ unitId: string }> }) => {
          // A stock refusal, which the payment's completion keeps pending. Read
          // by name: this file loads the service's module a second time.
          assert.equal(error.constructor.name, "ReservationUnitConflictError");
          assert.equal(Object.getPrototypeOf(error.constructor).name, "ReservationInventoryError");
          assert.equal(error.message, "errors.productNoLongerAvailable");
          assert.deepEqual(
            error.conflicts?.map((conflict) => conflict.unitId),
            [contested],
          );
          return true;
        },
      );
      assert.equal(await statusOf(id), "pending");
    });

    test("is confirmed by the store's change once the unit is given back", async () => {
      const { id, contested } = await holdingContestedUnit("quote");

      await assert.rejects(
        statusChange.changeStoreReservationStatus(caller(), { id, to: "confirmed" }),
        (error: { data?: { code?: string } }) =>
          error.data?.code === "RESERVATION_UNITS_UNAVAILABLE",
      );
      assert.equal(await statusOf(id), "quote");

      // The store takes the unit off the quote's line: the stock covers the rest.
      const held = await louezDb.db
        .select({ id: louezDb.reservationItemUnits.id })
        .from(louezDb.reservationItemUnits)
        .innerJoin(
          louezDb.reservationItems,
          eq(louezDb.reservationItemUnits.reservationItemId, louezDb.reservationItems.id),
        )
        .where(
          and(
            eq(louezDb.reservationItems.reservationId, id),
            eq(louezDb.reservationItemUnits.productUnitId, contested),
          ),
        );
      for (const assignment of held) {
        await louezDb.db
          .delete(louezDb.reservationItemUnits)
          .where(eq(louezDb.reservationItemUnits.id, assignment.id));
      }

      const change = await statusChange.changeStoreReservationStatus(caller(), {
        id,
        to: "confirmed",
      });
      assert.equal(change.to, "confirmed");
    });
  });

  describe("a reservation that holds a unit only the turnover buffer reaches", () => {
    // Two interchangeable units. Another booking returns unit U at noon; the
    // reservation starts at noon, in a store that asks an hour between
    // rentals, and holds U: the store assigned it over the buffer on purpose.
    const NOON = new Date("2030-07-01T12:00:00Z");
    const HOUR = 3_600_000;
    let settings: StoreSettings | null = null;

    before(async () => {
      const [store] = await louezDb.db
        .select({ settings: louezDb.stores.settings })
        .from(louezDb.stores)
        .where(eq(louezDb.stores.id, STORE));
      assert.ok(store?.settings);
      settings = store.settings;
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { ...settings, turnoverBufferMinutes: 60 } })
        .where(eq(louezDb.stores.id, STORE));
    });
    after(async () => {
      await louezDb.db.update(louezDb.stores).set({ settings }).where(eq(louezDb.stores.id, STORE));
    });

    type Case = "buffer only" | "overlap" | "retired" | "downtime";

    async function holdingReturnedUnit(status: "pending" | "quote", situation: Case) {
      const productId = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: STORE,
        name: productId,
        price: "1.00",
        pricingMode: "day",
        trackUnits: true,
        quantity: 2,
      });
      const [returned = "", other = ""] = [nextId("unt"), nextId("unt")];
      for (const unitId of [returned, other]) {
        await louezDb.db.insert(louezDb.productUnits).values({
          id: unitId,
          productId,
          identifier: `SECRET-${unitId}`,
          lifecycleStatus: situation === "retired" && unitId === returned ? "retired" : "active",
        });
      }
      if (situation === "downtime") {
        await louezDb.db.insert(louezDb.productUnitDowntimes).values({
          id: nextId("dwn"),
          productUnitId: returned,
          storeId: STORE,
          reason: "maintenance",
          startsAt: new Date(NOON.getTime() + 2 * HOUR),
          endsAt: null,
        });
      }
      const line = async (
        lineStatus: "pending" | "quote" | "confirmed",
        window: { start: Date; end: Date },
      ) => {
        const id = nextId("res");
        const itemId = nextId("itm");
        // A fixture, so it may start in any status.
        await louezDb.db.insert(louezDb.reservations).values({
          id,
          storeId: STORE,
          customerId: CUSTOMER,
          number: id,
          status: lineStatus,
          startDate: window.start,
          endDate: window.end,
          subtotalAmount: "1.00",
          depositAmount: "0.00",
          totalAmount: "1.00",
          source: "online",
        });
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: itemId,
          reservationId: id,
          productId,
          quantity: 1,
          unitPrice: "1.00",
          depositPerUnit: "0.00",
          totalPrice: "1.00",
          productSnapshot: { name: productId, description: null, images: [] },
        });
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: nextId("asg"),
          reservationItemId: itemId,
          productUnitId: returned,
          identifierSnapshot: `SECRET-${returned}`,
        });
        return id;
      };
      // Back at noon; an hour later, for a hard overlap.
      const returnedAt = new Date(NOON.getTime() + (situation === "overlap" ? HOUR : 0));
      await line("confirmed", { start: new Date(NOON.getTime() - 48 * HOUR), end: returnedAt });
      const id = await line(status, { start: NOON, end: new Date(NOON.getTime() + 48 * HOUR) });
      return { id, returned };
    }

    /** The reservation's status, and what its confirmation row recorded. */
    async function confirmationOf(id: string) {
      const [row] = await louezDb.db
        .select({ status: louezDb.reservations.status })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      const activity = await louezDb.db
        .select({
          type: louezDb.reservationActivity.activityType,
          metadata: louezDb.reservationActivity.metadata,
        })
        .from(louezDb.reservationActivity)
        .where(eq(louezDb.reservationActivity.reservationId, id));
      const confirmation = activity.find(
        (entry) => entry.type === "confirmed" || entry.type === "quote_accepted",
      );
      return {
        status: row?.status,
        bufferOnlyUnitIds: confirmation?.metadata?.turnoverBufferOnlyUnitIds,
      };
    }

    const paths = {
      "the store's change": {
        from: "quote" as const,
        confirm: async (id: string) => {
          try {
            await statusChange.changeStoreReservationStatus(caller(), { id, to: "confirmed" });
            return "confirmed";
          } catch (error) {
            const data = error && typeof error === "object" && "data" in error ? error.data : null;
            assert.equal(
              data && typeof data === "object" && "code" in data ? data.code : undefined,
              "RESERVATION_UNITS_UNAVAILABLE",
            );
            return "refused";
          }
        },
      },
      "the customer's acceptance": {
        from: "quote" as const,
        confirm: async (id: string) => {
          const result = await quotes.acceptQuote(STORE_SLUG, id);
          if (!("error" in result) || !result.error) return "confirmed";
          assert.equal(result.error, "errors.productNoLongerAvailable");
          return "refused";
        },
      },
      "the payment's confirmation": {
        from: "pending" as const,
        confirm: async (id: string) => {
          try {
            await payment.confirmPaidReservationOrThrow({
              reservationId: id,
              storeId: STORE,
              stripeCustomerId: null,
              stripePaymentMethodId: null,
              depositStatus: "none",
              activityMetadata: { source: "buffer" },
            });
            return "confirmed";
          } catch (error) {
            // Read by name: this file loads the service's module a second time.
            assert.equal(
              error instanceof Error && error.constructor.name,
              "ReservationUnitConflictError",
            );
            return "refused";
          }
        },
      },
    };

    for (const [path, { from, confirm }] of Object.entries(paths)) {
      test(`is confirmed by ${path}, which records the unit`, async () => {
        const { id, returned } = await holdingReturnedUnit(from, "buffer only");

        assert.equal(await confirm(id), "confirmed");
        assert.deepEqual(await confirmationOf(id), {
          status: "confirmed",
          bufferOnlyUnitIds: [returned],
        });
      });

      for (const situation of ["overlap", "retired", "downtime"] as const) {
        const state = { overlap: "still out", retired: "retired", downtime: "in downtime" }[
          situation
        ];
        test(`is not confirmed by ${path} when the unit is ${state}`, async () => {
          const { id } = await holdingReturnedUnit(from, situation);

          assert.equal(await confirm(id), "refused");
          assert.equal((await confirmationOf(id)).status, from);
        });
      }
    }
  });

  test("a store cancellation racing a paid checkout's confirmation", async () => {
    const { id, productId } = await reservationOfLastUnit("pending");
    await louezDb.db.delete(louezDb.apiEffects);

    const [cancelled, paid] = await raceOnReservation<unknown>(id, [
      () =>
        statusChange
          .changeStoreReservationStatus(caller(), { id, to: "cancelled" })
          .then((change) => change.to),
      () =>
        payment.confirmPaidReservationOrThrow({
          reservationId: id,
          storeId: STORE,
          stripeCustomerId: null,
          stripePaymentMethodId: null,
          depositStatus: "none",
          activityMetadata: { source: "race" },
        }),
    ]);
    assert.equal(cancelled, "cancelled");
    const state = await endState(id, productId);
    assert.equal(state.status, "cancelled");
    assert.equal(state.stock, 1, "the unit is back, whichever ran first");
    assert.equal(state.cancelled, 1);
    assert.equal(state.confirmed, paid ? 1 : 0, "a confirmation, when it won, happened once");
    assert.equal(state.storeEffects, 1, "the cancellation's effects were queued once");
    assert.equal(hooks.restarts, 0, "no deadlock: both lock the product first");
  });

  test("a store cancellation racing a customer's quote acceptance", async () => {
    const { id, productId } = await reservationOfLastUnit("quote");
    await louezDb.db.delete(louezDb.apiEffects);

    const [cancelled, accepted] = await raceOnReservation<unknown>(id, [
      () =>
        statusChange
          .changeStoreReservationStatus(caller(), { id, to: "cancelled" })
          .then((change) => change.to),
      () => quotes.acceptQuote(STORE_SLUG, id),
    ]);
    assert.equal(cancelled, "cancelled");
    const state = await endState(id, productId);
    assert.equal(state.status, "cancelled");
    assert.equal(state.stock, 1);
    assert.equal(state.cancelled, 1);
    const won = typeof accepted === "object" && accepted !== null && "success" in accepted;
    assert.equal(state.confirmed, won ? 1 : 0);
    assert.equal(quoteMessages.length, won ? 1 : 0, "the customer heard of it once, or not at all");
    assert.equal(state.storeEffects, 1);
    assert.equal(hooks.restarts, 0, "no deadlock: both lock the product first");
  });

  /** What a call ended with, without an unhandled rejection while it waits. */
  const settle = <T>(call: Promise<T>) =>
    call.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

  /**
   * Holds the reservation while `first` waits for its lock, then while
   * `second` waits too, then lets them go: `first` was queued first. Before
   * the owner entry, a writer that locked the reservation first got it, then
   * asked for the product `second` held: a deadlock.
   */
  async function raceInOrder<A, B>(id: string, first: () => Promise<A>, second: () => Promise<B>) {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
      const firstRun = settle(first());
      await waitForLockWaits(holder, database.name, 1);
      const secondRun = settle(second());
      await waitForLockWaits(holder, database.name, 2);
      await holder.commit();
      return { first: await firstRun, second: await secondRun };
    } finally {
      await holder.end();
    }
  }

  const storeChange = (id: string, to: "cancelled" | "rejected") => () =>
    statusChange.changeStoreReservationStatus(caller(), { id, to }).then((change) => change.to);

  const busyCode = (error: unknown) =>
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "code" in error.data
      ? error.data.code
      : undefined;

  const paidConfirmation = (id: string) =>
    payment.confirmPaidReservationOrThrow({
      reservationId: id,
      storeId: STORE,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      depositStatus: "none",
      activityMetadata: { source: "race" },
    });

  // The paid confirmation writes the payment's details on the pending row
  // before its transaction, so it cannot be queued first this way: the
  // checkout's suite races it against a product's writer instead.
  describe("every status writer against the store's change, in one lock order", () => {
    const writers: Array<{
      writer: string;
      from: "pending" | "quote";
      run: (id: string) => Promise<unknown>;
      store: "cancelled" | "rejected";
      end: { status: string; stock: number; storeRefused: boolean };
    }> = [
      {
        writer: "the customer's acceptance",
        from: "quote",
        run: (id: string) => quotes.acceptQuote(STORE_SLUG, id),
        store: "cancelled",
        // Accepted, then cancelled by the store: the unit comes back.
        end: { status: "cancelled", stock: 1, storeRefused: false },
      },
      {
        writer: "the customer's decline",
        from: "quote",
        run: (id: string) => quotes.declineQuote(STORE_SLUG, id),
        store: "cancelled",
        end: { status: "declined", stock: 1, storeRefused: true },
      },
      {
        writer: "the customer's cancellation",
        from: "pending",
        run: (id: string) => quotes.cancelReservationRequest(STORE_SLUG, id),
        store: "rejected",
        end: { status: "cancelled", stock: 1, storeRefused: true },
      },
      {
        writer: "the failed checkout",
        from: "pending",
        run: (id: string) =>
          louezDb.cancelFailedCheckoutReservation(
            { storeId: STORE, reservationId: id, reason: "session_creation_failed" },
            async () => {},
          ),
        store: "rejected",
        end: { status: "cancelled", stock: 1, storeRefused: true },
      },
      {
        writer: "the abandoned checkout",
        from: "pending",
        run: (id: string) =>
          abandoned.cancelAbandonedCheckout(
            { reservationId: id, checkoutSessionId: "cs_expired" },
            async () => {},
          ),
        store: "rejected",
        end: { status: "cancelled", stock: 1, storeRefused: true },
      },
    ];

    for (const { writer, from, run, store, end } of writers) {
      test(`${writer}, queued first, finishes before the store's change, with no restart`, async () => {
        const { id, productId } = await reservationOfLastUnit(from);

        const raced = await raceInOrder(id, () => run(id), storeChange(id, store));

        assert.ok(
          "value" in raced.first,
          `${writer} failed: ${String("error" in raced.first && raced.first.error)}`,
        );
        assert.equal("error" in raced.second, end.storeRefused, "the store's change");
        if ("error" in raced.second)
          assert.notEqual(busyCode(raced.second.error), "RESERVATION_BUSY");
        const state = await endState(id, productId);
        assert.equal(state.status, end.status);
        assert.equal(state.stock, end.stock);
        assert.equal(hooks.restarts, 0, "no deadlock, no product changed: no run started over");
      });
    }
  });

  test("a product added to a quote while its acceptance waits starts it over, and it takes the new product too", async () => {
    const { id, productId } = await reservationOfLastUnit("quote");
    const added = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id: added,
      storeId: STORE,
      name: added,
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: 1,
    });

    // The store's edit holds the quote while the acceptance waits, and adds a line.
    const holder = await database.connect();
    let accepted: Promise<unknown> | undefined;
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
      accepted = settle(quotes.acceptQuote(STORE_SLUG, id));
      await waitForLockWaits(holder, database.name, 1);
      await holder.query(
        `INSERT INTO reservation_items
           (id, reservation_id, product_id, quantity, unit_price, deposit_per_unit, total_price, product_snapshot)
         VALUES (?, ?, ?, 1, '1.00', '0.00', '1.00', '{"name":"added","description":null,"images":[]}')`,
        [nextId("itm"), id, added],
      );
      await holder.commit();
    } finally {
      await holder.end();
    }

    assert.deepEqual(await accepted, { value: { success: true, paymentUrl: null } });
    assert.equal(hooks.restarts, 1, "the acceptance started over once, for the added product");
    const state = await endState(id, productId);
    assert.equal(state.status, "confirmed");
    assert.equal(state.stock, 0);
    assert.equal(state.confirmed, 1);
    assert.equal((await endState(id, added)).stock, 0, "the added line's stock is taken");
  });

  describe("a reservation still busy after three runs", () => {
    beforeEach(() => {
      // Each run loses a deadlock before it gets the reservation.
      hooks.beforeReservationLock = async () => {
        throw Object.assign(new Error("Deadlock found when trying to get lock"), {
          code: "ER_LOCK_DEADLOCK",
          errno: 1213,
        });
      };
    });

    test("the store's change answers RESERVATION_BUSY and writes nothing", async () => {
      const { id, productId } = await reservationOfLastUnit("quote");
      await louezDb.db.delete(louezDb.apiEffects);

      await assert.rejects(
        statusChange.changeStoreReservationStatus(caller(), { id, to: "confirmed" }),
        (error: unknown) => busyCode(error) === "RESERVATION_BUSY",
      );
      assert.equal(hooks.restarts, 2, "three runs in all");
      const state = await endState(id, productId);
      assert.deepEqual(
        {
          status: state.status,
          stock: state.stock,
          confirmed: state.confirmed,
          storeEffects: state.storeEffects,
        },
        { status: "quote", stock: 1, confirmed: 0, storeEffects: 0 },
      );
      assert.deepEqual(dispatched, []);
    });

    test("the customer's acceptance answers its retryable error and writes nothing", async () => {
      const { id, productId } = await reservationOfLastUnit("quote");

      assert.deepEqual(await quotes.acceptQuote(STORE_SLUG, id), { error: "tryAgain" });
      assert.equal(hooks.restarts, 2);
      const state = await endState(id, productId);
      assert.deepEqual(
        { status: state.status, stock: state.stock, confirmed: state.confirmed },
        { status: "quote", stock: 1, confirmed: 0 },
      );
      assert.equal(quoteMessages.length, 0, "the customer is told nothing");
    });

    test("the paid confirmation throws, so Stripe sends the event again, and its claim stays", async () => {
      const { id, productId } = await reservationOfLastUnit("pending");
      // The claim, committed before the confirmation (claimCompletedCheckoutPayment).
      const claim = nextId("pay");
      await louezDb.db.insert(louezDb.payments).values({
        id: claim,
        reservationId: id,
        amount: "1.00",
        type: "rental",
        method: "stripe",
        status: "completed",
        stripeCheckoutSessionId: "cs_paid",
      });

      await assert.rejects(paidConfirmation(id), { name: "ReservationChangeBusyError" });
      assert.equal(hooks.restarts, 2);
      const state = await endState(id, productId);
      assert.deepEqual(
        { status: state.status, stock: state.stock, confirmed: state.confirmed },
        { status: "pending", stock: 1, confirmed: 0 },
      );
      const [kept] = await louezDb.db
        .select({ status: louezDb.payments.status })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.id, claim));
      assert.equal(kept?.status, "completed");
    });
  });
});

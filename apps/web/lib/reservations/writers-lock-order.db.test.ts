import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { StoreSettings } from "@louez/types";

import { STORE_KEY } from "@/app/(dashboard)/dashboard/reservations/actions-test-stubs";
import {
  createTestDatabase,
  readLockWaiters,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type RowLock,
  type TestDatabase,
} from "@louez/db/testing";

// The writers of a reservation that are not status changes, each racing the
// store's status change of the same reservation: the unit assignment, the move
// to another unit, the automatic extension, and the date change of the API
// and agents (`changeReservationDates`, which takes the products' locks only
// through the owner entry and `lockReservationProducts`). Each takes the reservation's
// products by id, then the reservation, then its rows, as the status change
// does (`lockReservationInTransaction`, rule C1 of
// docs/domain/reservation-changes.md). Before, each locked the reservation
// first: queued first on the reservation, or queued second behind the status
// change on the product, it then waited for the product the status change held
// while the status change waited for the reservation, a deadlock.
//
// Each race is run in both orders. While the writer waits, the test reads its
// row locks: queued first, it holds the product and waits for the reservation;
// queued second, it waits for the product and holds no reservation. That fails
// on a writer that inverts the order, whether or not the race then deadlocks
// and a retry hides it. Each race ends with both writes, or with the writer's
// refusal when the status change made it impossible, and no run started over.
// A product added to the reservation while a writer waits for it starts that
// writer over once.

const STORE = "store_writer_locks";
const CUSTOMER = "cus_writer_locks";
const SETTINGS: StoreSettings = {
  reservationMode: "request",
  advanceNoticeMinutes: 0,
  currency: "EUR",
};
const START = new Date("2030-06-01T09:00:00.000Z");
const END = new Date("2030-06-03T09:00:00.000Z");
/** The extension's new end, as the customer's form sends it, in the store's zone (UTC). */
const EXTENDED_END = "2030-06-04T09:00";

// What the product page's actions and the extension's effects call besides the
// database: the session, the page cache, the contract, the invoice, the
// calendar and the e-mails, which a test has no runtime for.
const STUBS: Record<string, string> = {
  "next/cache": "export function revalidatePath() {}\n",
  "@/lib/auth": "export async function auth() { return null; }\n",
  "@/lib/store-context": `export async function getCurrentStore() { return globalThis[${JSON.stringify(STORE_KEY)}] ?? null; }\n`,
  "@/lib/pdf/generate": "export async function generateContract() {}\n",
  "@/lib/invoicing/service":
    "export async function tryGenerateInvoiceForPayment() { return {}; }\n",
  "@/lib/integrations/calendar/sync": "export async function markReservationForCalendarSync() {}\n",
  "@/lib/email/send": "export async function sendReservationModifiedEmail() {}\n",
};
const STUBBED_PARENTS = [
  "/dashboard/products/[id]/actions.ts",
  "/lib/reservations/extension-service.ts",
];
const STUB_SCHEME = "louez-writer-lock-order-test:";
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (STUBBED_PARENTS.some((file) => parent.endsWith(file)) && specifier in STUBS) {
      return { shortCircuit: true, url: `${STUB_SCHEME}${specifier}` };
    }
    return next(specifier, context);
  },
  load(url: string, context: unknown, next: (url: string, context: unknown) => unknown) {
    if (!url.startsWith(STUB_SCHEME)) return next(url, context);
    return { shortCircuit: true, format: "module", source: STUBS[url.slice(STUB_SCHEME.length)] };
  },
});

describe(
  "reservation writers against a status change (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    const hooks = reservationChangeTestHooks();
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let assignment: typeof import("@/app/(dashboard)/dashboard/reservations/actions");
    let move: typeof import("@/app/(dashboard)/dashboard/products/[id]/actions");
    let extension: typeof import("@/lib/reservations/extension-service");
    let statusChange: typeof import("@louez/api/services/reservation-status");
    let dateChange: typeof import("@louez/api/services/reservation-dates");
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("writer_lock_order");
      louezDb = await import("@louez/db");
      assignment = await import("@/app/(dashboard)/dashboard/reservations/actions");
      move = await import("@/app/(dashboard)/dashboard/products/[id]/actions");
      extension = await import("@/lib/reservations/extension-service");
      // packages/api is ES modules: its services need the CommonJS packages'
      // names by hand. Loaded last, as the mocks change how later modules load.
      await import("@louez/mcp/testing/cjs-named-exports");
      statusChange = await import("@louez/api/services/reservation-status");
      dateChange = await import("@louez/api/services/reservation-dates");

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "user_writer_locks",
        name: "Lock order",
        slug: "lock-order",
        settings: SETTINGS,
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "renter@lock-order.test",
        firstName: "Renter",
        lastName: "Test",
      });
      // What the session holds of the store: the dashboard's actions read it.
      Reflect.set(globalThis, STORE_KEY, {
        id: STORE,
        userId: "",
        name: "Lock order",
        slug: "lock-order",
        address: null,
        settings: SETTINGS,
        stripeAccountId: null,
      });
    });

    after(async () => {
      Reflect.deleteProperty(globalThis, STORE_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      hooks.restarts = 0;
      hooks.beforeReservationLock = null;
    });

    // 21 characters, as nanoid ids: the actions check their shape.
    const nextId = (prefix: string) =>
      `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

    /** A product with three units, free of charge: an extension costs nothing more. */
    async function trackedProduct() {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: id,
        price: "0.00",
        pricingMode: "day",
        trackUnits: true,
        quantity: 3,
      });
      const units: string[] = [];
      for (const index of [1, 2, 3]) {
        const unitId = nextId("unt");
        units.push(unitId);
        await louezDb.db
          .insert(louezDb.productUnits)
          .values({ id: unitId, productId: id, identifier: `U-${index}` });
      }
      return { id, units };
    }

    /** A line of one unit of the product, holding `unitId` when given. */
    async function line(reservationId: string, productId: string, unitId?: string) {
      const itemId = nextId("itm");
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: itemId,
        reservationId,
        productId,
        quantity: 1,
        unitPrice: "0.00",
        depositPerUnit: "0.00",
        totalPrice: "0.00",
        productSnapshot: { name: productId, description: null, images: [] },
      });
      if (unitId) {
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: nextId("asg"),
          reservationItemId: itemId,
          productUnitId: unitId,
          identifierSnapshot: unitId,
        });
      }
      return itemId;
    }

    /** A confirmed, paid reservation of one line, which holds the product's first unit. */
    async function confirmedReservation() {
      const product = await trackedProduct();
      const id = nextId("res");
      // A fixture, so it may start confirmed.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: id,
        status: "confirmed",
        startDate: START,
        endDate: END,
        subtotalAmount: "0.00",
        depositAmount: "0.00",
        totalAmount: "0.00",
        source: "online",
        currency: "EUR",
      });
      const itemId = await line(id, product.id, product.units[0]);
      return { id, itemId, product };
    }

    const caller = () => ({
      storeId: STORE,
      userId: "user_writer_locks",
      credential: { kind: "session" as const, id: null },
      transport: "rpc" as const,
      customers: true,
      store: {
        id: STORE,
        name: "Lock order",
        slug: "lock-order",
        ownerUserId: "user_writer_locks",
        settings: null,
        customerNotificationSettings: null,
      },
      ports: {
        afterCommit: () => {},
        runReservationEffects: async () => {},
        insurance: { createContract: async () => null, cancelContract: async () => {} },
        dispatchEffects: () => {},
      },
    });

    /** The store's cancellation: its products, then the reservation. */
    const cancellation = (id: string) => () =>
      statusChange.changeStoreReservationStatus(caller(), { id, to: "cancelled" });

    /** What a call ended with, without an unhandled rejection while it waits. */
    const settle = <T>(call: Promise<T>) =>
      call.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    /**
     * Holds `row` while `first` waits for a lock, then while `second` waits too,
     * then lets them go: `first` was queued first. Returns what each ended with,
     * and the row locks each held, and waited for, while it waited.
     */
    async function raceInOrder<A, B>(
      row: { table: "reservations" | "products"; id: string },
      first: () => Promise<A>,
      second: () => Promise<B>,
    ) {
      const holder = await database.connect();
      try {
        await holder.beginTransaction();
        await holder.query(`SELECT id FROM \`${row.table}\` WHERE id = ? FOR UPDATE`, [row.id]);
        const firstRun = settle(first());
        await waitForLockWaits(holder, database.name, 1);
        const [firstLocks] = await readLockWaiters(holder, database.name);
        const secondRun = settle(second());
        await waitForLockWaits(holder, database.name, 2);
        const secondLocks = (await readLockWaiters(holder, database.name)).find(
          (waiter) => waiter.transactionId !== firstLocks?.transactionId,
        );
        await holder.commit();
        // Asserted once both calls have ended, so a failing race leaves none running.
        assert.ok(firstLocks && secondLocks, "both callers waited on a lock");
        return {
          first: { ...(await firstRun), locks: firstLocks },
          second: { ...(await secondRun), locks: secondLocks },
        };
      } finally {
        await holder.end();
      }
    }

    const rowsOf = (locks: RowLock[], table: RowLock["table"]) =>
      locks.filter((lock) => lock.table === table).map((lock) => lock.id);

    async function reservationRow(id: string) {
      const [row] = await louezDb.db
        .select({ status: louezDb.reservations.status, endDate: louezDb.reservations.endDate })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      assert.ok(row);
      return row;
    }

    async function heldUnits(itemId: string) {
      const rows = await louezDb.db
        .select({ unitId: louezDb.reservationItemUnits.productUnitId })
        .from(louezDb.reservationItemUnits)
        .where(eq(louezDb.reservationItemUnits.reservationItemId, itemId));
      return rows.map((row) => row.unitId).sort();
    }

    /** A product of the store, not on the reservation yet. */
    async function otherProduct() {
      const { id } = await trackedProduct();
      return id;
    }

    /**
     * Holds the reservation while `call` waits for it, adds a line of another
     * product, then lets it go: `call` locked the products it read before the
     * line was added.
     */
    async function withProductAdded<T>(reservationId: string, call: () => Promise<T>) {
      const added = await otherProduct();
      const holder = await database.connect();
      try {
        await holder.beginTransaction();
        await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [reservationId]);
        const running = settle(call());
        await waitForLockWaits(holder, database.name, 1);
        await holder.query(
          `INSERT INTO reservation_items
           (id, reservation_id, product_id, quantity, unit_price, deposit_per_unit, total_price, product_snapshot)
         VALUES (?, ?, ?, 1, '0.00', '0.00', '0.00', '{"name":"added","description":null,"images":[]}')`,
          [nextId("itm"), reservationId, added],
        );
        await holder.commit();
        return await running;
      } finally {
        await holder.end();
      }
    }

    const writers: Array<{
      writer: string;
      /** Runs the writer on the reservation; resolves with what it answered. */
      run: (fixture: Awaited<ReturnType<typeof confirmedReservation>>) => Promise<unknown>;
      /** What the writer wrote, read back. */
      wrote: (fixture: Awaited<ReturnType<typeof confirmedReservation>>) => Promise<boolean>;
      /** Whether the writer refuses a reservation the store cancelled first, and how. */
      refusedAfterCancellation: RegExp | null;
    }> = [
      {
        writer: "the unit assignment",
        run: ({ itemId, product }) =>
          assignment.assignUnitsToReservationItem(itemId, [product.units[1] ?? ""]),
        wrote: async ({ itemId, product }) =>
          JSON.stringify(await heldUnits(itemId)) === JSON.stringify([product.units[1]]),
        refusedAfterCancellation: null,
      },
      {
        writer: "the move to another unit",
        run: ({ itemId, product }) =>
          move.reassignReservationItemUnit({
            reservationItemId: itemId,
            fromUnitId: product.units[0] ?? "",
            toUnitId: product.units[2] ?? "",
          }),
        wrote: async ({ itemId, product }) =>
          JSON.stringify(await heldUnits(itemId)) === JSON.stringify([product.units[2]]),
        refusedAfterCancellation: null,
      },
      {
        writer: "the automatic extension",
        run: ({ id }) =>
          extension.startExtension({
            storeId: STORE,
            customerId: CUSTOMER,
            reservationId: id,
            endDate: EXTENDED_END,
            expectedSupplement: 0,
          }),
        wrote: async ({ id }) =>
          (await reservationRow(id)).endDate.toISOString() === `${EXTENDED_END}:00.000Z`,
        // An extension is quoted for a confirmed or ongoing reservation only.
        refusedAfterCancellation: /invalidStatus/,
      },
      {
        writer: "the date change of the API and agents",
        run: ({ id }) =>
          dateChange.changeReservationDates(caller(), {
            id,
            endDate: new Date(`${EXTENDED_END}:00.000Z`),
            notifyCustomer: false,
          }),
        wrote: async ({ id }) =>
          (await reservationRow(id)).endDate.toISOString() === `${EXTENDED_END}:00.000Z`,
        // Checked again under the lock: a cancelled reservation is not edited.
        refusedAfterCancellation: /cancelled reservation cannot be changed/,
      },
    ];

    /**
     * The answer of a writer that went through: the actions answer success,
     * the extension its status, the date change that it changed the dates.
     */
    const succeeded = (answer: unknown) =>
      typeof answer === "object" &&
      answer !== null &&
      (("success" in answer && answer.success === true) ||
        ("status" in answer && answer.status === "confirmed") ||
        ("changed" in answer && answer.changed === true));

    for (const { writer, run, wrote, refusedAfterCancellation } of writers) {
      describe(writer, () => {
        test("queued first, on the reservation: it waits holding its product, writes, then the store cancels", async () => {
          const fixture = await confirmedReservation();

          const raced = await raceInOrder(
            { table: "reservations", id: fixture.id },
            () => run(fixture),
            cancellation(fixture.id),
          );

          // Its products first: waiting for the reservation, it holds them.
          assert.deepEqual(rowsOf(raced.first.locks.waitsFor, "reservations"), [fixture.id]);
          assert.deepEqual(rowsOf(raced.first.locks.holds, "products"), [fixture.product.id]);
          assert.ok(
            "value" in raced.first,
            `${writer} failed: ${String("error" in raced.first && raced.first.error)}`,
          );
          assert.ok(
            succeeded(raced.first.value),
            `${writer} answered ${JSON.stringify(raced.first.value)}`,
          );
          assert.ok(
            "value" in raced.second,
            `the cancellation failed: ${String("error" in raced.second && raced.second.error)}`,
          );
          assert.equal((await reservationRow(fixture.id)).status, "cancelled");
          assert.ok(await wrote(fixture), `${writer} wrote what it was asked`);
          assert.equal(hooks.restarts, 0, "no deadlock, no product changed: no run started over");
        });

        test("queued second, behind the cancellation on the product: it waits holding no reservation, then runs", async () => {
          const fixture = await confirmedReservation();

          const raced = await raceInOrder(
            { table: "products", id: fixture.product.id },
            cancellation(fixture.id),
            () => run(fixture),
          );

          // Behind the cancellation on the product, it has not locked the reservation.
          assert.deepEqual(rowsOf(raced.second.locks.waitsFor, "products"), [fixture.product.id]);
          assert.deepEqual(rowsOf(raced.second.locks.holds, "reservations"), []);
          assert.ok(
            "value" in raced.first,
            `the cancellation failed: ${String("error" in raced.first && raced.first.error)}`,
          );
          assert.equal((await reservationRow(fixture.id)).status, "cancelled");
          if (refusedAfterCancellation) {
            assert.ok("error" in raced.second, `${writer} went through a cancelled reservation`);
            assert.match(String(raced.second.error), refusedAfterCancellation);
            assert.equal(await wrote(fixture), false, `${writer} wrote nothing`);
          } else {
            assert.ok(
              "value" in raced.second,
              `${writer} failed: ${String("error" in raced.second && raced.second.error)}`,
            );
            assert.ok(
              succeeded(raced.second.value),
              `${writer} answered ${JSON.stringify(raced.second.value)}`,
            );
            assert.ok(await wrote(fixture), `${writer} wrote what it was asked`);
          }
          assert.equal(hooks.restarts, 0, "no deadlock, no product changed: no run started over");
        });

        test("a product added while it waits for the reservation starts it over once, and it writes", async () => {
          const fixture = await confirmedReservation();

          const result = await withProductAdded(fixture.id, () => run(fixture));

          assert.ok(
            "value" in result,
            `${writer} failed: ${String("error" in result && result.error)}`,
          );
          assert.ok(succeeded(result.value), `${writer} answered ${JSON.stringify(result.value)}`);
          assert.equal(hooks.restarts, 1, "it started over once, under the added product's lock");
          assert.ok(await wrote(fixture), `${writer} wrote what it was asked`);
        });
      });
    }
  },
);

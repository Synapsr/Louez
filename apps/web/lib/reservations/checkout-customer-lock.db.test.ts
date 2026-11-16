import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

// A reservation is never created for a customer who no longer exists: the
// checkout reads its customer under the row's lock (after its products), and
// a customer's deletion decides under the same lock (after the store row)
// that they hold no reservation. Whichever locks first runs; the other waits,
// then answers from what the first committed.

const STORE_KEY = "__louezCheckoutCustomerLockStore";
const STUB = "louez-checkout-customer-lock:";
// The dashboard action's request context, which a test has no Next.js runtime for.
const STUBS: Record<string, string> = {
  "next/cache": "export function revalidatePath() {}\n",
  "@/lib/store-context": `export async function getCurrentStore() { return globalThis[${JSON.stringify(STORE_KEY)}] ?? null; }\n`,
  "@/lib/discord/platform-notifications": "export async function notifyCustomerCreated() {}\n",
};
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // The checkout modules import Next.js-only guards and the file storage SDK.
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = decodeURIComponent(context.parentURL ?? "");
    if (parent.endsWith("/dashboard/customers/actions.ts") && specifier in STUBS) {
      return { url: `${STUB}${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url: string, context: unknown, next: (url: string, context: unknown) => unknown) {
    if (url.startsWith(STUB)) {
      return { shortCircuit: true, format: "module", source: STUBS[url.slice(STUB.length)] };
    }
    return next(url, context);
  },
});

const STORE = "store_checkout_lock";
const START = "2030-06-01T09:00:00.000Z";
const END = "2030-06-03T09:00:00.000Z";

describe(
  "a checkout against a customer's deletion (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let checkout: typeof import("./create-reservation");
    let actions: typeof import("../../app/(dashboard)/dashboard/customers/actions");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, "0")}`;
    let product = "";
    let customer = "";
    let email = "";

    before(async () => {
      database = await createTestDatabase("checkout_customer_lock");
      louezDb = await import("@louez/db");
      checkout = await import("./create-reservation");
      actions = await import("../../app/(dashboard)/dashboard/customers/actions");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Lock",
        slug: "checkout-lock",
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: true,
        },
      });
      Reflect.set(globalThis, STORE_KEY, { id: STORE });
      product = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: product,
        storeId: STORE,
        name: "Kayak",
        price: "10.00",
        pricingMode: "day",
        quantity: 10,
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      // The checkout's owner entry runs again on a lost deadlock: counted, to be none.
      reservationChangeTestHooks().restarts = 0;
      customer = nextId("cus");
      email = `${customer}@lock.test`;
      await louezDb.db.insert(louezDb.customers).values({
        id: customer,
        storeId: STORE,
        email,
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    /** The online store's checkout of the customer's e-mail. */
    const book = (promoCode?: string) =>
      checkout.createReservation({
        source: "online",
        storeId: STORE,
        customer: { email, firstName: "Ada", lastName: "Lovelace" },
        items: [
          {
            productId: product,
            quantity: 1,
            startDate: START,
            endDate: END,
            unitPrice: 0,
            depositPerUnit: 0,
          },
        ],
        subtotalAmount: 0,
        depositAmount: 0,
        totalAmount: 0,
        ...(promoCode ? { promoCode } : {}),
      });

    /** Each reservation of the store, with whether its customer exists. */
    const bookings = async () => {
      const rows = await louezDb.db
        .select({ id: louezDb.reservations.id, customerId: louezDb.reservations.customerId })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.storeId, STORE));
      const customers = await louezDb.db
        .select({ id: louezDb.customers.id })
        .from(louezDb.customers)
        .where(eq(louezDb.customers.storeId, STORE));
      const known = new Set(customers.map((row) => row.id));
      return rows.map((row) => ({ customerId: row.customerId, exists: known.has(row.customerId) }));
    };

    test("the deletion locks first: the checkout waits, finds no customer, and books for the customer it adds again", async () => {
      const before = (await bookings()).length;
      // A session of the customer, locked, holds the deletion inside its transaction.
      const session = nextId("ses");
      await louezDb.db.insert(louezDb.customerSessions).values({
        id: session,
        customerId: customer,
        token: `token-${session}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const holder = await database.connect();
      try {
        await holder.beginTransaction();
        await holder.query("SELECT id FROM customer_sessions WHERE id = ? FOR UPDATE", [session]);
        const deletion = actions.deleteCustomer(customer);
        await waitForLockWaits(holder, database.name, 1);
        const booking = book();
        await waitForLockWaits(holder, database.name, 2);
        await holder.commit();
        assert.deepEqual(await deletion, { success: true });
        const result = await booking;
        assert.ok(result.ok, JSON.stringify(result));
        assert.notEqual(result.customerId, customer, "not the customer who was deleted");
      } finally {
        await holder.end();
      }
      assert.equal(
        reservationChangeTestHooks().restarts,
        0,
        "no deadlock: the checkout never ran again",
      );
      const after = await bookings();
      assert.equal(after.length, before + 1);
      assert.ok(
        after.every((row) => row.exists),
        "every reservation's customer exists",
      );
    });

    test("the checkout locks first: the deletion waits, then is refused, the customer having a reservation", async () => {
      // A promo code, locked, holds the checkout after it took its customer.
      const promo = nextId("prm");
      const code = `LOCK${counter}`;
      await louezDb.db.insert(louezDb.promoCodes).values({
        id: promo,
        storeId: STORE,
        code,
        type: "percentage",
        value: "10.00",
      });
      const holder = await database.connect();
      try {
        await holder.beginTransaction();
        await holder.query("SELECT id FROM promo_codes WHERE id = ? FOR UPDATE", [promo]);
        const booking = book(code);
        await waitForLockWaits(holder, database.name, 1);
        const deletion = actions.deleteCustomer(customer);
        await waitForLockWaits(holder, database.name, 2);
        await holder.commit();
        const result = await booking;
        assert.ok(result.ok, JSON.stringify(result));
        assert.equal(result.customerId, customer);
        assert.deepEqual(await deletion, { error: "errors.customerHasReservations" });
        assert.equal(
          reservationChangeTestHooks().restarts,
          0,
          "no deadlock: the checkout never ran again",
        );
      } finally {
        await holder.end();
      }
      assert.ok((await bookings()).every((row) => row.exists));
    });

    test("the customer's lock, the checkout's and the deletion's, reads through the primary key", async () => {
      const connection = await database.connect();
      try {
        // lockCustomerRow (packages/db): the one statement both take.
        const [plan] = await connection.query<import("mysql2/promise").RowDataPacket[]>(
          "EXPLAIN SELECT id FROM customers FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE",
          [customer],
        );
        assert.equal(plan[0]?.key, "PRIMARY");
      } finally {
        await connection.end();
      }
    });
  },
);

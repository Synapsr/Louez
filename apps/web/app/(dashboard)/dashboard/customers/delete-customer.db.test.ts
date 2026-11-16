import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

// A customer's deletion and the store's creation of a reservation for that
// customer (`reservations.create`) take their locks in one order: the store
// row, then the customer, then what hangs on the customer (the outbox among
// it). The deletion decides under the customer's lock that they hold no
// reservation. Whichever locks first runs; the other waits, and then answers
// from what the first committed: the deletion is refused, the customer now
// having a reservation, or the creation finds no customer.

const STORE_KEY = "__louezDeleteCustomerTestStore";
const STUB = "louez-delete-customer-test:";
// The request context of a server action, which a test has no Next.js runtime for.
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
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
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

const STORE = "store_delete_customer";
const START = "2030-06-01T09:00:00+00:00";
const END = "2030-06-03T09:00:00+00:00";

describe(
  "a customer's deletion against a reservation's creation (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let actions: typeof import("./actions");
    let creation: typeof import("@louez/api/services/reservation-create");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, "0")}`;
    let product = "";

    before(async () => {
      database = await createTestDatabase("delete_customer");
      louezDb = await import("@louez/db");
      actions = await import("./actions");
      // packages/api is ES modules: it needs the CommonJS packages' names by
      // hand. Loaded after the action, as the mocks change how later modules load.
      await import("@louez/mcp/testing/cjs-named-exports");
      creation = await import("@louez/api/services/reservation-create");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Delete",
        slug: "delete-customer",
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

    let customer = "";
    beforeEach(async () => {
      customer = nextId("cus");
      await louezDb.db.insert(louezDb.customers).values({
        id: customer,
        storeId: STORE,
        email: `${customer}@delete.test`,
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    /** The store's creation for the customer, through the service; `confirm` runs under its locks. */
    const create = (confirm: () => Promise<null>) =>
      creation.createStoreReservation(
        {
          storeId: STORE,
          userId: null,
          credential: { kind: "api_key", id: "delete_key" },
          transport: "openapi",
          store: { id: STORE, name: "Delete", slug: "delete-customer", ownerUserId: "owner" },
          ports: {
            afterCommit: () => {},
            runReservationEffects: async () => {},
            dispatchEffects: () => {},
          },
        },
        {
          customer: { id: customer },
          startDate: START,
          endDate: END,
          lines: [{ productId: product, quantity: 1 }],
          status: "quote",
          notifyCustomer: false,
        },
        { confirm },
      );

    const reservationsOf = () =>
      louezDb.db
        .select({ id: louezDb.reservations.id })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.customerId, customer));
    const customerExists = async () =>
      (
        await louezDb.db
          .select({ id: louezDb.customers.id })
          .from(louezDb.customers)
          .where(eq(louezDb.customers.id, customer))
      ).length === 1;

    test("the creation locks first: the deletion waits, then is refused, the customer having a reservation", async () => {
      const monitor = await database.connect();
      try {
        let deletion: Promise<unknown> | null = null;
        const created = await create(async () => {
          // Under the creation's locks, the store and the customer held: the deletion starts.
          deletion = actions.deleteCustomer(customer);
          await waitForLockWaits(monitor, database.name, 1);
          return null;
        });
        assert.ok(deletion, "the deletion ran");
        assert.deepEqual(await deletion, { error: "errors.customerHasReservations" });
        assert.deepEqual(
          (await reservationsOf()).map((row) => row.id),
          [created.id],
        );
        assert.equal(await customerExists(), true);
      } finally {
        await monitor.end();
      }
    });

    test("the deletion locks first: the creation waits, then finds no customer, nothing created, nothing asked", async () => {
      // A session of the customer, locked, holds the deletion inside its transaction.
      const session = nextId("ses");
      await louezDb.db.insert(louezDb.customerSessions).values({
        id: session,
        customerId: customer,
        token: `token-${session}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const holder = await database.connect();
      let asked = 0;
      try {
        await holder.beginTransaction();
        await holder.query("SELECT id FROM customer_sessions WHERE id = ? FOR UPDATE", [session]);
        const deletion = actions.deleteCustomer(customer);
        await waitForLockWaits(holder, database.name, 1);
        const creating = create(async () => {
          asked += 1;
          return null;
        }).then(
          () => "created",
          (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
        );
        // The creation waits for the store row the deletion holds.
        await waitForLockWaits(holder, database.name, 2);
        await holder.commit();
        assert.deepEqual(await deletion, { success: true });
        assert.equal(await creating, "CUSTOMER_NOT_FOUND");
      } finally {
        await holder.end();
      }
      assert.equal(asked, 0, "nothing asked: an approval it carried would be unused");
      assert.deepEqual(await reservationsOf(), []);
      assert.equal(await customerExists(), false);
    });

    test("a customer with a reservation is refused, one without is deleted, as before", async () => {
      await create(async () => null);
      assert.deepEqual(await actions.deleteCustomer(customer), {
        error: "errors.customerHasReservations",
      });
      const other = nextId("cus");
      await louezDb.db.insert(louezDb.customers).values({
        id: other,
        storeId: STORE,
        email: `${other}@delete.test`,
        firstName: "Grace",
        lastName: "Hopper",
      });
      assert.deepEqual(await actions.deleteCustomer(other), { success: true });
      assert.deepEqual(await actions.deleteCustomer(other), { error: "errors.customerNotFound" });
    });
  },
);

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
      // The creation's owner entry runs again on a lost deadlock: counted, to be none.
      reservationChangeTestHooks().restarts = 0;
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
    type Form = "id" | "email";
    const create = (confirm: () => Promise<null>, form: Form = "id") =>
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
          customer:
            form === "id"
              ? { id: customer }
              : { email: `${customer}@delete.test`, firstName: "Someone", lastName: "Else" },
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

    /** The indexes of `customers` the database's record locks are on. */
    const customerLockIndexes = async (monitor: import("mysql2/promise").Connection) => {
      const [rows] = await monitor.query<import("mysql2/promise").RowDataPacket[]>(
        `SELECT DISTINCT INDEX_NAME AS name FROM performance_schema.data_locks
         WHERE OBJECT_SCHEMA = ? AND OBJECT_NAME = 'customers' AND LOCK_TYPE = 'RECORD'`,
        [database.name],
      );
      return rows.map((row) => String(row.name)).sort();
    };

    for (const form of ["id", "email"] as const) {
      test(`by ${form}, the creation locks first: it holds its customer by the primary key; the deletion waits, then is refused`, async () => {
        const monitor = await database.connect();
        try {
          let deletion: Promise<unknown> | null = null;
          let indexes: string[] = [];
          const created = await create(async () => {
            // Under the creation's locks: the customer is held through the primary key only.
            indexes = await customerLockIndexes(monitor);
            deletion = actions.deleteCustomer(customer);
            await waitForLockWaits(monitor, database.name, 1);
            return null;
          }, form);
          assert.deepEqual(indexes, ["PRIMARY"], "no lock on another index of customers");
          assert.ok(deletion, "the deletion ran");
          assert.deepEqual(await deletion, { error: "errors.customerHasReservations" });
          assert.deepEqual(
            (await reservationsOf()).map((row) => row.id),
            [created.id],
          );
          assert.deepEqual(created.customer, { id: customer, created: false });
          assert.equal(await customerExists(), true);
          assert.equal(
            reservationChangeTestHooks().restarts,
            0,
            "no deadlock: the creation never ran again",
          );
        } finally {
          await monitor.end();
        }
      });

      test(`by ${form}, the deletion locks first: the creation waits, then ${form === "id" ? "finds no customer, nothing created, nothing asked" : "adds the customer again"}`, async () => {
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
        let outcome: unknown;
        try {
          await holder.beginTransaction();
          await holder.query("SELECT id FROM customer_sessions WHERE id = ? FOR UPDATE", [session]);
          const deletion = actions.deleteCustomer(customer);
          await waitForLockWaits(holder, database.name, 1);
          const creating = create(async () => {
            asked += 1;
            return null;
          }, form).then(
            (created) => created,
            (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
          );
          // The creation waits for the store row the deletion holds.
          await waitForLockWaits(holder, database.name, 2);
          await holder.commit();
          assert.deepEqual(await deletion, { success: true });
          outcome = await creating;
        } finally {
          await holder.end();
        }
        assert.equal(await customerExists(), false);
        assert.equal(
          reservationChangeTestHooks().restarts,
          0,
          "no deadlock: the creation never ran again",
        );
        if (form === "id") {
          assert.equal(outcome, "CUSTOMER_NOT_FOUND");
          assert.equal(asked, 0, "nothing asked: an approval it carried would be unused");
          assert.deepEqual(await reservationsOf(), []);
        } else {
          const created = outcome as { customer: { id: string; created: boolean } };
          assert.equal(created.customer.created, true, "a customer with that e-mail, added again");
          assert.notEqual(created.customer.id, customer);
        }
      });
    }

    test("the customer's lock, by either form and by the deletion, reads through the primary key", async () => {
      const connection = await database.connect();
      try {
        for (const statement of [
          // lockCustomerRow (packages/db), which the creation takes for both forms.
          "EXPLAIN SELECT id FROM customers FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE",
          // The deletion's lock.
          "EXPLAIN SELECT id FROM customers WHERE id = ? AND store_id = ? FOR UPDATE",
        ]) {
          const [plan] = await connection.query<import("mysql2/promise").RowDataPacket[]>(
            statement,
            [customer, STORE],
          );
          assert.equal(plan[0]?.key, "PRIMARY", statement);
        }
      } finally {
        await connection.end();
      }
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

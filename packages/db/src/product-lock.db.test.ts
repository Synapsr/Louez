import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import {
  createTestDatabase,
  readLockWaiters,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "./testing/test-database";

// The locks a transaction takes on several products, on a migrated database:
// by id. The catalog here has its slugs in the opposite order of its ids, so
// a read through the store's slugs meets the rows last id first; and other
// stores hold ten times as many products, which is what makes the optimizer
// read a list of this store's products through its slugs when the statement
// names no index.
const STORE = "product_lock_store";
const COUNT = 100;
const OTHER_STORES = 10;
const idOf = (index: number) => `prd_${String(index).padStart(4, "0")}`;
const IDS = Array.from({ length: COUNT }, (_, index) => idOf(index));
const LOWEST = idOf(0);
const HIGHEST = idOf(COUNT - 1);

describe("product row locks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("./index");

  before(async () => {
    database = await createTestDatabase("product_lock");
    louezDb = await import("./index");
    await louezDb.db.insert(louezDb.products).values(
      IDS.map((id, index) => ({
        id,
        storeId: STORE,
        name: id,
        slug: `slug-${String(COUNT - index).padStart(4, "0")}`,
        price: "1.00",
        pricingMode: "day" as const,
      })),
    );
    for (let store = 0; store < OTHER_STORES; store++) {
      await louezDb.db.insert(louezDb.products).values(
        IDS.map((_, index) => ({
          id: `other_${store}_${String(index).padStart(4, "0")}`,
          storeId: `other_store_${store}`,
          name: "other",
          slug: `s-${index}`,
          price: "1.00",
          pricingMode: "day" as const,
        })),
      );
    }
    await louezDb.db.execute("ANALYZE TABLE products");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /**
   * Runs `lock` in a transaction while another connection holds `heldId`, and
   * returns the product rows it held while it waited, and the one it waited for.
   */
  async function locksWhileHeld(
    heldId: string,
    lock: (tx: import("./index").Transaction) => Promise<void>,
  ) {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [heldId]);
      const locking = louezDb.db.transaction((tx) => lock(tx));
      await waitForLockWaits(holder, database.name, 1);
      const [waiter] = await readLockWaiters(holder, database.name);
      await holder.commit();
      await locking;
      const ids = (locks: Array<{ table: string; id: string }> = []) =>
        [...new Set(locks.filter((row) => row.table === "products").map((row) => row.id))].sort();
      return { held: ids(waiter?.holds), awaited: ids(waiter?.waitsFor) };
    } finally {
      await holder.end();
    }
  }

  const LOCKERS: Array<[string, (tx: import("./index").Transaction) => Promise<void>]> = [
    ["a list of products", (tx) => louezDb.lockProductRows(tx, STORE, [...IDS].reverse())],
    ["every product of a store", (tx) => louezDb.lockStoreProductRows(tx, STORE)],
  ];

  for (const [name, lock] of LOCKERS) {
    test(`${name}: the lowest id is asked for first, with no other row held`, async () => {
      const { held, awaited } = await locksWhileHeld(LOWEST, lock);
      assert.deepEqual(awaited, [LOWEST]);
      assert.deepEqual(held, []);
    });

    test(`${name}: the highest id is asked for last, with every other row held`, async () => {
      const { held, awaited } = await locksWhileHeld(HIGHEST, lock);
      assert.deepEqual(awaited, [HIGHEST]);
      assert.deepEqual(held, IDS.slice(0, -1));
    });
  }

  test("a list locks only its rows, and only those of its store", async () => {
    const { held, awaited } = await locksWhileHeld(idOf(7), (tx) =>
      louezDb.lockProductRows(tx, STORE, [idOf(9), idOf(7), idOf(3), idOf(3)]),
    );
    assert.deepEqual(awaited, [idOf(7)]);
    assert.deepEqual(held, [idOf(3)]);
    // Another store's id names no row of this one: nothing to wait for.
    await louezDb.db.transaction((tx) => louezDb.lockProductRows(tx, "another_store", [idOf(7)]));
    await louezDb.db.transaction((tx) => louezDb.lockProductRows(tx, STORE, []));
  });
});

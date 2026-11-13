import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";

import type { ReservationStatus } from "./reservation-status";
import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "./testing/test-database";

// The owner entry of a reservation's change and its lock tokens, on a migrated
// database: the isolation it runs at, the order it locks in, the restart rule,
// and the tokens a status change and a stock move refuse.

const STORE = "store_change";

/** What MySQL raises on a lost deadlock: the owner entry starts over on it. */
const deadlock = () =>
  Object.assign(new Error("Deadlock found when trying to get lock"), {
    code: "ER_LOCK_DEADLOCK",
    errno: 1213,
  });

describe("reservation change owner entry (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("./index");
  let counter = 0;
  const hooks = reservationChangeTestHooks();

  before(async () => {
    database = await createTestDatabase("reservation_change");
    louezDb = await import("./index");
  });

  after(async () => {
    hooks.beforeReservationLock = null;
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    hooks.restarts = 0;
    hooks.beforeReservationLock = null;
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function createReservation(status: ReservationStatus): Promise<string> {
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
      source: "online",
    });
    return id;
  }

  /** A consumable product with `stock` left, and a line of `quantity` on the reservation. */
  async function addConsumable(reservationId: string, { stock = 5, quantity = 2 } = {}) {
    const productId = nextId("prd");
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
      id: nextId("itm"),
      reservationId,
      productId,
      quantity,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "1.00",
      productSnapshot: { name: productId, description: null, images: [] },
    });
    return productId;
  }

  async function readState(id: string, productId: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    const [product] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    const activity = await louezDb.db
      .select({ id: louezDb.reservationActivity.id })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    return { status: row?.status, stock: product?.quantity, activity: activity.length };
  }

  const input = (reservationId: string, to: ReservationStatus) => ({
    reservationId,
    storeId: STORE,
    to,
    actor: "store_user" as const,
    actorUserId: null,
  });

  /** Whether another connection finds the row locked. */
  async function isLocked(table: "products" | "reservations", id: string) {
    const other = await database.connect();
    try {
      await other.query(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE NOWAIT`, [id]);
      return false;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ER_LOCK_NOWAIT") return true;
      throw error;
    } finally {
      await other.end();
    }
  }

  test("runs READ COMMITTED although the server's default is REPEATABLE READ", async () => {
    const connection = await database.connect();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT @@GLOBAL.transaction_isolation AS level",
      );
      assert.equal(rows[0]?.level, "REPEATABLE-READ");
    } finally {
      await connection.end();
    }
    const id = await createReservation("pending");

    /** Reads the notes, lets another connection change them, reads them again. */
    const readTwice = async (tx: import("./index").Transaction) => {
      const read = async () => {
        const [row] = await tx
          .select({ notes: louezDb.reservations.internalNotes })
          .from(louezDb.reservations)
          .where(eq(louezDb.reservations.id, id));
        return row?.notes ?? null;
      };
      const first = await read();
      await louezDb.db
        .update(louezDb.reservations)
        .set({ internalNotes: nextId("note") })
        .where(eq(louezDb.reservations.id, id));
      return { first, second: await read() };
    };

    // The server's default keeps the transaction's first snapshot.
    const plain = await louezDb.db.transaction(readTwice);
    assert.equal(plain.second, plain.first);
    // The owner entry sees what committed since.
    const owned = await louezDb.runReservationTransaction(readTwice);
    assert.notEqual(owned.second, owned.first);
  });

  test("locks the reservation's products, then the reservation, before its work", async () => {
    const id = await createReservation("pending");
    const productId = await addConsumable(id);

    const order: string[] = [];
    hooks.beforeReservationLock = async () => {
      order.push(`product locked: ${await isLocked("products", productId)}`);
      order.push(`reservation locked: ${await isLocked("reservations", id)}`);
    };
    await louezDb.runReservationChange({ reservationId: id, storeId: STORE }, async () => {
      order.push(`reservation locked: ${await isLocked("reservations", id)}`);
    });

    assert.deepEqual(order, [
      "product locked: true",
      "reservation locked: false",
      "reservation locked: true",
    ]);
  });

  test("a product added while the change waits for the reservation starts it over, under the new product's lock", async () => {
    const id = await createReservation("pending");
    const first = await addConsumable(id);
    // A product of the store, on no line of the reservation yet.
    const added = await addConsumable(await createReservation("cancelled"), {
      stock: 5,
      quantity: 1,
    });

    // Another writer holds the reservation; the change locks its product and waits.
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
      const changing = louezDb.runReservationChange(
        { reservationId: id, storeId: STORE },
        async (tx, lock) => {
          const locked = await isLocked("products", added);
          const change = await louezDb.changeReservationStatus(tx, {
            ...input(id, "confirmed"),
            lock,
          });
          return { locked, changed: change.changed };
        },
      );
      await waitForLockWaits(holder, database.name, 1);
      // It adds a line of a product the change has not locked.
      await holder.query(
        `INSERT INTO reservation_items
           (id, reservation_id, product_id, quantity, unit_price, deposit_per_unit, total_price, product_snapshot)
         VALUES (?, ?, ?, 1, '1.00', '0.00', '1.00', '{"name":"added","description":null,"images":[]}')`,
        [nextId("itm"), id, added],
      );
      await holder.commit();

      assert.deepEqual(await changing, { locked: true, changed: true });
    } finally {
      await holder.end();
    }

    assert.equal(hooks.restarts, 1, "one restart, for the product added");
    assert.deepEqual(await readState(id, first), { status: "confirmed", stock: 3, activity: 1 });
    assert.equal((await readState(id, added)).stock, 4, "the added line's stock is taken too");
  });

  test("still busy after three runs, it throws ReservationChangeBusyError and writes nothing", async () => {
    const id = await createReservation("pending");
    const productId = await addConsumable(id);
    let runs = 0;
    hooks.beforeReservationLock = async () => {
      runs += 1;
      throw deadlock();
    };

    await assert.rejects(
      louezDb.runReservationChange({ reservationId: id, storeId: STORE }, (tx, lock) =>
        louezDb.changeReservationStatus(tx, { ...input(id, "confirmed"), lock }),
      ),
      (error: unknown) =>
        louezDb.isReservationChangeBusyError(error) &&
        error.reservationId === id &&
        louezDb.isDatabaseDeadlock(error.cause),
    );
    assert.equal(runs, 3);
    assert.equal(hooks.restarts, 2);
    assert.deepEqual(await readState(id, productId), { status: "pending", stock: 5, activity: 0 });
  });

  test("an error that is not a conflict is thrown at once, after one run", async () => {
    const id = await createReservation("pending");
    let runs = 0;
    await assert.rejects(
      louezDb.runReservationChange({ reservationId: id, storeId: STORE }, async () => {
        runs += 1;
        throw new Error("contract validation failed");
      }),
      { message: "contract validation failed" },
    );
    assert.equal(runs, 1);
    assert.equal(hooks.restarts, 0);
  });

  test("a status change and a stock move refuse a reservation-only lock, and nothing is written", async () => {
    const cases: Array<{
      from: ReservationStatus;
      run: (
        tx: import("./index").Transaction,
        lock: import("./index").ReservationOnlyLock,
        id: string,
      ) => Promise<unknown>;
    }> = [
      // Takes stock.
      {
        from: "pending",
        run: (tx, lock, id) =>
          louezDb.changeReservationStatus(tx, { ...input(id, "confirmed"), lock }),
      },
      // Gives stock back.
      {
        from: "confirmed",
        run: (tx, lock, id) =>
          louezDb.changeReservationStatus(tx, { ...input(id, "cancelled"), lock }),
      },
      // Runs a check.
      {
        from: "pending",
        run: (tx, lock, id) =>
          louezDb.changeReservationStatus(tx, {
            ...input(id, "cancelled"),
            lock,
            beforeWrite: async () => {},
          }),
      },
      // Takes stock directly; the type refuses it too.
      {
        from: "confirmed",
        run: (tx, lock) =>
          louezDb.consumeReservationStock(
            tx,
            // @ts-expect-error A reservation-only lock is not a stock lock.
            lock,
          ),
      },
    ];
    for (const { from, run } of cases) {
      const id = await createReservation(from);
      const productId = await addConsumable(id);
      await assert.rejects(
        louezDb.runReservationOnlyChange({ reservationId: id, storeId: STORE }, (tx, lock) =>
          run(tx, lock, id),
        ),
        { name: "ReservationLockError" },
      );
      assert.deepEqual(await readState(id, productId), { status: from, stock: 5, activity: 0 });
    }
  });

  test("a reservation-only lock cancels a pending reservation", async () => {
    const id = await createReservation("pending");
    const productId = await addConsumable(id);

    const change = await louezDb.runReservationOnlyChange(
      { reservationId: id, storeId: STORE },
      (tx, lock) => louezDb.changeReservationStatus(tx, { ...input(id, "cancelled"), lock }),
    );

    assert.equal(change.changed, true);
    assert.deepEqual(await readState(id, productId), {
      status: "cancelled",
      stock: 5,
      activity: 1,
    });
  });

  test("a lock is refused in another transaction, after its own ended, and for another reservation", async () => {
    const id = await createReservation("pending");
    const other = await createReservation("pending");
    const productId = await addConsumable(id);
    const scope = { reservationId: id, storeId: STORE };

    // Used in another transaction, open beside its own.
    await louezDb.runReservationChange(scope, async (_tx, lock) => {
      await assert.rejects(
        louezDb.db.transaction((otherTx) =>
          louezDb.changeReservationStatus(otherTx, { ...input(id, "cancelled"), lock }),
        ),
        { name: "ReservationLockError", message: /another transaction/ },
      );
    });

    // Kept after its transaction committed.
    let kept: import("./index").ReservationProductsLock | undefined;
    let keptTx: import("./index").Transaction | undefined;
    await louezDb.runReservationChange(scope, async (tx, lock) => {
      kept = lock;
      keptTx = tx;
    });
    assert.ok(kept && keptTx);
    await assert.rejects(
      louezDb.changeReservationStatus(keptTx, { ...input(id, "cancelled"), lock: kept }),
      { name: "ReservationLockError", message: /has ended/ },
    );

    // Taken for one reservation, used for another.
    await louezDb.runReservationChange(scope, (tx, lock) =>
      assert.rejects(louezDb.changeReservationStatus(tx, { ...input(other, "cancelled"), lock }), {
        name: "ReservationLockError",
        message: /another reservation/,
      }),
    );

    // Made by hand.
    await louezDb.runReservationChange(scope, (tx) =>
      assert.rejects(
        louezDb.changeReservationStatus(tx, {
          ...input(id, "cancelled"),
          // @ts-expect-error Only the owner entry makes a lock.
          lock: { kind: "products", reservationId: id, storeId: STORE },
        }),
        { name: "ReservationLockError", message: /Not a reservation lock/ },
      ),
    );

    // The lock entry refuses a transaction the owner entry did not open.
    await assert.rejects(
      louezDb.db.transaction((tx) =>
        louezDb.lockReservationInTransaction(
          // @ts-expect-error Only the owner entry opens one.
          { tx },
          scope,
        ),
      ),
      { name: "ReservationLockError" },
    );

    assert.deepEqual(await readState(id, productId), { status: "pending", stock: 5, activity: 0 });
    assert.equal((await readState(other, productId)).status, "pending");
  });

  /** A consumable product with 5 in stock, on no reservation yet. */
  async function createConsumable() {
    const productId = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId: STORE,
      name: productId,
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: 5,
    });
    return productId;
  }

  /** Inserts a quote and its line of 2 of `productId`, as a creation does after locking the product. */
  async function insertWithLine(tx: import("./index").Transaction, id: string, productId: string) {
    const { lock } = await louezDb.insertReservation(tx, {
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "quote",
      startDate: new Date("2026-02-01T09:00:00Z"),
      endDate: new Date("2026-02-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source: "manual",
    });
    await tx.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: id,
      productId,
      quantity: 2,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "1.00",
      productSnapshot: { name: productId, description: null, images: [] },
    });
    return lock;
  }

  test("an inserted reservation's lock takes its stock once, and allows nothing else", async () => {
    const id = nextId("res");
    const other = await createReservation("quote");
    const productId = await createConsumable();

    // A transaction the owner entry did not open, as the dashboard's creation's.
    await louezDb.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`);
      const lock = await insertWithLine(tx, id, productId);
      await assert.rejects(
        louezDb.changeReservationStatus(tx, {
          ...input(id, "cancelled"),
          // @ts-expect-error An inserted reservation's lock is not a status change's.
          lock,
        }),
        { name: "ReservationLockError", message: /does not allow/ },
      );
      await assert.rejects(
        louezDb.changeReservationStatus(tx, {
          ...input(other, "cancelled"),
          // @ts-expect-error An inserted reservation's lock is not a status change's.
          lock,
        }),
        { name: "ReservationLockError", message: /another reservation/ },
      );
      await louezDb.consumeReservationStock(tx, lock);
      await assert.rejects(louezDb.consumeReservationStock(tx, lock), {
        name: "ReservationLockError",
        message: /already used/,
      });
    });

    assert.equal((await readState(id, productId)).stock, 3, "taken once");
    assert.equal((await readState(other, productId)).status, "quote");
  });

  test("an inserted reservation's lock dies with the owner entry's transaction, committed or rolled back", async () => {
    for (const outcome of ["committed", "rolled back"] as const) {
      const id = nextId("res");
      const productId = await createConsumable();
      let kept: import("./index").InsertedReservationLock | undefined;
      let keptTx: import("./index").Transaction | undefined;

      const run = louezDb.runReservationTransaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`);
        kept = await insertWithLine(tx, id, productId);
        keptTx = tx;
        if (outcome === "rolled back") throw new Error("the checkout failed");
      });
      if (outcome === "committed") await run;
      else await assert.rejects(run, { message: "the checkout failed" });

      assert.ok(kept && keptTx);
      await assert.rejects(louezDb.consumeReservationStock(keptTx, kept), {
        name: "ReservationLockError",
        message: /has ended/,
      });
      assert.equal((await readState(id, productId)).stock, 5, `${outcome}: nothing taken`);
    }
  });

  test("a token cannot be retargeted or upgraded: it allows what it was issued for", async () => {
    const id = await createReservation("confirmed");
    const other = await createReservation("confirmed");
    const productId = await addConsumable(id);
    const otherProduct = await addConsumable(other);

    await louezDb.runReservationOnlyChange(
      { reservationId: id, storeId: STORE },
      async (tx, lock) => {
        // Strict mode: writing a frozen token's field, or defining one, throws.
        assert.ok(Object.isFrozen(lock));
        assert.throws(
          () => Object.assign(lock, { kind: "products", reservationId: other }),
          TypeError,
        );
        assert.throws(() => Object.defineProperty(lock, "kind", { value: "products" }), TypeError);
        assert.equal(Reflect.set(lock, "reservationId", other), false);
        assert.deepEqual(
          { kind: lock.kind, reservationId: lock.reservationId },
          { kind: "reservation", reservationId: id },
        );

        // A copy of the token, with its class and the fields wanted, is not one the module issued.
        const lookalike: unknown = Object.assign(Object.create(Object.getPrototypeOf(lock)), {
          kind: "products",
          reservationId: other,
          storeId: STORE,
        });
        for (const attempt of [lock, lookalike]) {
          await assert.rejects(
            louezDb.changeReservationStatus(tx, {
              ...input(other, "cancelled"),
              // @ts-expect-error The lookalike is no token, and the type says so too.
              lock: attempt,
            }),
            { name: "ReservationLockError" },
          );
          await assert.rejects(
            louezDb.restoreReservationStock(
              tx,
              // @ts-expect-error Neither is a stock lock, and the type says so too.
              attempt,
            ),
            { name: "ReservationLockError" },
          );
        }
      },
    );

    assert.deepEqual(await readState(id, productId), {
      status: "confirmed",
      stock: 5,
      activity: 0,
    });
    assert.deepEqual(await readState(other, otherProduct), {
      status: "confirmed",
      stock: 5,
      activity: 0,
    });
  });
});

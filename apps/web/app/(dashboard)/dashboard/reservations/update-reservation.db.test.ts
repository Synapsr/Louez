import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import { STORE_KEY } from "./actions-test-stubs";

// An edit of a reservation on a migrated database: it is refused with its
// shortfalls when it asks more stock than is free, written and traced when
// the caller books over it, refused when the reservation changed since it was
// read, and it never leaves lines from one edit with the total of another.

const STORE = "store_edits";
const DAY = 86_400_000;
const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date(START.getTime() + 2 * DAY);

type Settings = { currency: string; pendingBlocksAvailability?: boolean };

describe("updateReservation (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let inbox: typeof import("@louez/api/services/inbox");
  let counter = 0;

  const useStore = (settings: Settings = { currency: "eur" }) =>
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      // No user id: analytics skips the event.
      userId: "",
      name: "Edits",
      slug: "edits",
      address: null,
      settings,
      stripeAccountId: null,
    });

  before(async () => {
    database = await createTestDatabase("update_reservation");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    // packages/api is ES modules: its services need the CommonJS packages'
    // names by hand. Loaded last, as the mocks change how later modules load.
    await import("@louez/mcp/testing/cjs-named-exports");
    inbox = await import("@louez/api/services/inbox");

    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "owner_edits", name: "Edits", slug: "edits" });
    await louezDb.db.insert(louezDb.customers).values({
      id: "customer_edits",
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
    useStore();
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  /** A product counted by quantity, at 10.00 a day. */
  async function product(name: string, quantity: number) {
    const id = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: STORE,
      name,
      price: "10.00",
      pricingMode: "day",
      quantity,
    });
    return id;
  }

  /** A product sold by size, with one tracked unit per given size. */
  async function sizedProduct(sizes: string[]) {
    const id = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: STORE,
      name: "Wetsuit",
      price: "10.00",
      pricingMode: "day",
      trackUnits: true,
      bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
      quantity: sizes.length,
    });
    const unitIds: string[] = [];
    for (const [index, size] of sizes.entries()) {
      const unitId = nextId("unt");
      unitIds.push(unitId);
      await louezDb.db.insert(louezDb.productUnits).values({
        id: unitId,
        productId: id,
        identifier: `W-${index + 1}`,
        attributes: { size },
        combinationKey: `size:${size}`,
      });
    }
    return { id, unitIds };
  }

  /**
   * A confirmed reservation of several lines of one sized product. A line with
   * a size chose that combination; one without is served by any unit, and may
   * hold one already.
   */
  async function sizedReservation(
    productId: string,
    lines: Array<{ size?: string; quantity: number; assignedUnitId?: string }>,
  ) {
    const id = nextId("res");
    const total = lines.reduce((sum, line) => sum + line.quantity * 20, 0);
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer_edits",
      number: id,
      status: "confirmed",
      startDate: START,
      endDate: END,
      subtotalAmount: total.toFixed(2),
      depositAmount: "0.00",
      totalAmount: total.toFixed(2),
      deliveryFee: "0.00",
      discountAmount: "0.00",
      source: "manual",
    });
    const items: Array<{ itemId: string; productId: string }> = [];
    for (const line of lines) {
      const itemId = nextId("itm");
      items.push({ itemId, productId });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: itemId,
        reservationId: id,
        productId,
        quantity: line.quantity,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: (line.quantity * 20).toFixed(2),
        productSnapshot: { name: "Wetsuit", description: null, images: [] },
        combinationKey: line.size ? `size:${line.size}` : null,
        selectedAttributes: line.size ? { size: line.size } : null,
      });
      if (line.assignedUnitId) {
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: nextId("asg"),
          reservationItemId: itemId,
          productUnitId: line.assignedUnitId,
          identifierSnapshot: "W",
        });
      }
    }
    return { id, items };
  }

  /** A reservation of one line, priced as the action prices it: 10.00 a day and a unit. */
  async function reservation(
    line: { productId: string; quantity: number },
    options: {
      status?: "pending" | "quote" | "confirmed";
      start?: Date;
      end?: Date;
      deliveryFee?: string;
      discountAmount?: string;
    } = {},
  ) {
    const id = nextId("res");
    const itemId = nextId("itm");
    const start = options.start ?? START;
    const end = options.end ?? END;
    const linePrice = line.quantity * 10 * Math.round((end.getTime() - start.getTime()) / DAY);
    const deliveryFee = Number(options.deliveryFee ?? 0);
    const discount = Number(options.discountAmount ?? 0);
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer_edits",
      number: id,
      status: options.status ?? "confirmed",
      startDate: start,
      endDate: end,
      subtotalAmount: linePrice.toFixed(2),
      depositAmount: "0.00",
      totalAmount: (linePrice + deliveryFee - discount).toFixed(2),
      deliveryFee: deliveryFee.toFixed(2),
      discountAmount: discount.toFixed(2),
      source: "manual",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId: id,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: linePrice.toFixed(2),
      productSnapshot: { name: "Line", description: null, images: [] },
    });
    return { id, itemId, productId: line.productId };
  }

  /** The line of a reservation as the edit form submits it, with another quantity. */
  const submitted = (
    booking: { itemId: string; productId: string },
    quantity: number,
    name = "Bike",
  ) => ({
    id: booking.itemId,
    productId: booking.productId,
    quantity,
    unitPrice: 10,
    depositPerUnit: 0,
    productSnapshot: { name },
  });

  /** A line the edit form adds. */
  const added = (productId: string, quantity: number, name: string) => ({
    productId,
    quantity,
    unitPrice: 10,
    depositPerUnit: 0,
    productSnapshot: { name },
  });

  const storeDelivery = { outbound: { method: "store" }, return: { method: "store" } } as const;

  /** Everything an edit may write, to compare before and after a refusal. */
  async function rowsOf(reservationId: string) {
    const r = louezDb.reservations;
    const [row] = await louezDb.db
      .select({
        status: r.status,
        startDate: r.startDate,
        endDate: r.endDate,
        subtotalAmount: r.subtotalAmount,
        depositAmount: r.depositAmount,
        totalAmount: r.totalAmount,
        deliveryFee: r.deliveryFee,
        discountAmount: r.discountAmount,
        updatedAt: r.updatedAt,
      })
      .from(r)
      .where(eq(r.id, reservationId));
    const i = louezDb.reservationItems;
    const items = await louezDb.db
      .select({
        id: i.id,
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
      })
      .from(i)
      .where(eq(i.reservationId, reservationId))
      .orderBy(i.id);
    return { row, items, activity: await activityOf(reservationId) };
  }

  /**
   * What the edits of a reservation left in its history, oldest first. The
   * contract's automatic validation writes a "modified" row of its own kind.
   */
  async function activityOf(reservationId: string) {
    const a = louezDb.reservationActivity;
    const rows = await louezDb.db
      .select({ metadata: a.metadata, createdAt: a.createdAt })
      .from(a)
      .where(and(eq(a.reservationId, reservationId), eq(a.activityType, "modified")))
      .orderBy(a.createdAt);
    return rows.flatMap((entry) =>
      entry.metadata && !entry.metadata.kind ? [entry.metadata] : [],
    );
  }

  /** The ids of the reservations the inbox lists as overbooked. */
  async function overbookedInInbox() {
    const { items } = await inbox.listInbox(
      {
        store: {
          id: STORE,
          slug: "edits",
          onboardingCompleted: true,
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
          availabilityRulesChangedAt: null,
          settings: null,
        },
        urls: {
          dashboard: (path) => `https://app.example.test${path}`,
          storefront: (slug, path) => `https://${slug}.example.test${path}`,
        },
        hostedBy: null,
        reads: { reservations: true },
        operationsOf: null,
      },
      { limit: 100 },
      // Past the thirty seconds an item waits before it shows.
      { now: new Date(Date.now() + 10 * 60_000) },
    );
    return items.flatMap((item) =>
      item.type === "overbooking" && item.reservation ? [item.reservation.id] : [],
    );
  }

  const shortfall = (
    productId: string,
    productName: string,
    requested: number,
    available: number,
  ) => ({
    productId,
    productName,
    combinationKey: null,
    requested,
    available,
  });

  describe("a quantity raised past the stock, on the same dates", () => {
    test("is refused with its shortfall, and nothing is written", async () => {
      const bikes = await product("Bike", 2);
      const booking = await reservation({ productId: bikes, quantity: 1 });
      const before = await rowsOf(booking.id);

      const result = await actions.updateReservation(booking.id, {
        items: [submitted(booking, 3)],
      });

      assert.deepEqual(result, {
        error: "errors.insufficientCapacity",
        shortfalls: [shortfall(bikes, "Bike", 3, 2)],
      });
      assert.deepEqual(await rowsOf(booking.id), before);
    });

    test("is written with the override, traced, and shown in the inbox until an edit fits", async () => {
      const bikes = await product("Bike", 2);
      const booking = await reservation({ productId: bikes, quantity: 1 });

      const forced = await actions.updateReservation(booking.id, {
        items: [submitted(booking, 3)],
        allowOverbooking: true,
      });

      assert.equal(forced.error, undefined);
      const written = await rowsOf(booking.id);
      assert.deepEqual(
        written.items.map((item) => [item.quantity, item.totalPrice]),
        [[3, "60.00"]],
      );
      assert.equal(written.row?.totalAmount, "60.00");
      assert.equal(written.activity.length, 1);
      assert.equal(written.activity[0]?.overbooked, true);
      assert.deepEqual(written.activity[0]?.overbookingShortfalls, [
        shortfall(bikes, "Bike", 3, 2),
      ]);
      assert.ok((await overbookedInInbox()).includes(booking.id));

      // Back within the stock: no override is asked, and the item leaves the inbox.
      const fitted = await actions.updateReservation(booking.id, {
        items: [submitted(booking, 2)],
      });

      assert.equal(fitted.error, undefined);
      const [, verdict] = await activityOf(booking.id);
      assert.equal(verdict?.overbooked, false);
      assert.equal(verdict?.overbookingShortfalls, undefined);
      assert.ok(!(await overbookedInInbox()).includes(booking.id));
    });
  });

  describe("a line added for a product with no free stock", () => {
    async function bookingAndTakenHelmet() {
      const bikes = await product("Bike", 2);
      const helmets = await product("Helmet", 1);
      await reservation({ productId: helmets, quantity: 1 });
      const booking = await reservation({ productId: bikes, quantity: 1 });
      const items = [submitted(booking, 1), added(helmets, 1, "Helmet")];
      return { booking, helmets, items };
    }

    test("is refused with its shortfall, and nothing is written", async () => {
      const { booking, helmets, items } = await bookingAndTakenHelmet();
      const before = await rowsOf(booking.id);

      const result = await actions.updateReservation(booking.id, { items });

      assert.deepEqual(result, {
        error: "errors.insufficientCapacity",
        shortfalls: [shortfall(helmets, "Helmet", 1, 0)],
      });
      assert.deepEqual(await rowsOf(booking.id), before);
    });

    test("is written with the override, traced, and shown in the inbox", async () => {
      const { booking, helmets, items } = await bookingAndTakenHelmet();

      const result = await actions.updateReservation(booking.id, { items, allowOverbooking: true });

      assert.equal(result.error, undefined);
      const written = await rowsOf(booking.id);
      assert.deepEqual(
        written.items.map((item) => item.productId).sort(),
        [booking.productId, helmets].sort(),
      );
      assert.equal(written.row?.totalAmount, "40.00");
      assert.deepEqual(written.activity[0]?.overbookingShortfalls, [
        shortfall(helmets, "Helmet", 1, 0),
      ]);
      assert.ok((await overbookedInInbox()).includes(booking.id));
    });
  });

  describe("dates moved onto an occupied window", () => {
    const LATER = {
      start: new Date(START.getTime() + 5 * DAY),
      end: new Date(END.getTime() + 5 * DAY),
    };

    async function bookingBesideAnother() {
      const bikes = await product("Bike", 1);
      await reservation({ productId: bikes, quantity: 1 }, LATER);
      return { bikes, booking: await reservation({ productId: bikes, quantity: 1 }) };
    }

    test("answer the shortfalls, not a hard refusal", async () => {
      const { bikes, booking } = await bookingBesideAnother();
      const before = await rowsOf(booking.id);

      const result = await actions.updateReservation(booking.id, {
        startDate: LATER.start,
        endDate: LATER.end,
      });

      assert.deepEqual(result, {
        error: "errors.insufficientCapacity",
        shortfalls: [shortfall(bikes, "Bike", 1, 0)],
      });
      assert.deepEqual(await rowsOf(booking.id), before);
    });

    test("are written with the override", async () => {
      const { booking } = await bookingBesideAnother();

      const result = await actions.updateReservation(booking.id, {
        startDate: LATER.start,
        endDate: LATER.end,
        allowOverbooking: true,
      });

      assert.equal(result.error, undefined);
      const written = await rowsOf(booking.id);
      assert.deepEqual([written.row?.startDate, written.row?.endDate], [LATER.start, LATER.end]);
      assert.equal(written.activity[0]?.overbooked, true);
    });
  });

  test("an edit that asks no more stock of an overbooked reservation needs no override", async () => {
    const bikes = await product("Bike", 2);
    const helmets = await product("Helmet", 5);
    // Booked over the stock when it was created: four bikes of two.
    const booking = await reservation({ productId: bikes, quantity: 4 });

    // The delivery alone: no stock check, no verdict.
    const delivery = await actions.updateReservation(booking.id, { delivery: storeDelivery });
    assert.equal(delivery.error, undefined);
    assert.equal("overbooked" in ((await activityOf(booking.id))[0] ?? {}), false);

    // A lower quantity, still over the stock: written, and the verdict says so.
    const lowered = await actions.updateReservation(booking.id, { items: [submitted(booking, 3)] });
    assert.equal(lowered.error, undefined);
    assert.deepEqual((await activityOf(booking.id))[1]?.overbookingShortfalls, [
      shortfall(bikes, "Bike", 3, 2),
    ]);

    // More of another product that is free: the bikes were not raised.
    const withHelmet = await actions.updateReservation(booking.id, {
      items: [submitted(booking, 3), added(helmets, 1, "Helmet")],
    });
    assert.equal(withHelmet.error, undefined);
    assert.equal((await activityOf(booking.id))[2]?.overbooked, true);

    // A shorter window inside the booked one asks for nothing more either.
    const shorter = await actions.updateReservation(booking.id, {
      endDate: new Date(END.getTime() - DAY),
    });
    assert.equal(shorter.error, undefined);

    // More bikes is refused again.
    const helmetLine = (await rowsOf(booking.id)).items.find((item) => item.productId === helmets);
    assert.ok(helmetLine);
    const raised = await actions.updateReservation(booking.id, {
      items: [
        submitted(booking, 4),
        submitted({ itemId: helmetLine.id, productId: helmets }, 1, "Helmet"),
      ],
    });
    assert.equal(raised.error, "errors.insufficientCapacity");
  });

  describe("a reservation whose status holds no stock", () => {
    test("a quote is edited past the stock without a check", async () => {
      const bikes = await product("Bike", 2);
      const booking = await reservation({ productId: bikes, quantity: 1 }, { status: "quote" });

      const result = await actions.updateReservation(booking.id, {
        items: [submitted(booking, 3)],
      });

      assert.equal(result.error, undefined);
      const written = await rowsOf(booking.id);
      assert.equal(written.items[0]?.quantity, 3);
      assert.equal("overbooked" in (written.activity[0] ?? {}), false);
    });

    test("a request is checked only when the store lets requests hold stock", async () => {
      const bikes = await product("Bike", 2);
      const held = await reservation({ productId: bikes, quantity: 1 }, { status: "pending" });
      const free = await reservation(
        { productId: bikes, quantity: 1 },
        {
          status: "pending",
          start: new Date(START.getTime() + 20 * DAY),
          end: new Date(END.getTime() + 20 * DAY),
        },
      );

      const refused = await actions.updateReservation(held.id, { items: [submitted(held, 3)] });
      assert.equal(refused.error, "errors.insufficientCapacity");

      useStore({ currency: "eur", pendingBlocksAvailability: false });
      try {
        const written = await actions.updateReservation(free.id, { items: [submitted(free, 3)] });
        assert.equal(written.error, undefined);
        assert.equal("overbooked" in ((await activityOf(free.id))[0] ?? {}), false);
      } finally {
        useStore();
      }
    });
  });

  describe("a reservation changed between the read and the write", () => {
    /** Runs the edit while another transaction, not committed yet, holds the reservation. */
    async function editDuring(
      reservationId: string,
      change: { sql: string; values: unknown[] },
      edit: () => Promise<{ error?: string }>,
    ) {
      const [result] = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [
            reservationId,
          ]);
          await holder.query(change.sql, change.values);
        },
        [edit],
      );
      return result;
    }

    test("one of its lines: the edit is refused and writes nothing", async () => {
      const bikes = await product("Bike", 5);
      const booking = await reservation({ productId: bikes, quantity: 1 });

      const result = await editDuring(
        booking.id,
        {
          sql: "UPDATE reservation_items SET quantity = 2, total_price = '40.00' WHERE id = ?",
          values: [booking.itemId],
        },
        () => actions.updateReservation(booking.id, { delivery: storeDelivery }),
      );

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
      const after = await rowsOf(booking.id);
      assert.deepEqual(
        after.items.map((item) => [item.quantity, item.totalPrice]),
        [[2, "40.00"]],
      );
      assert.equal(after.row?.totalAmount, "20.00", "the edit's total was not written");
      assert.deepEqual(after.activity, []);
    });

    test("its status: the edit is refused and writes nothing", async () => {
      const bikes = await product("Bike", 5);
      const booking = await reservation({ productId: bikes, quantity: 1 });

      const result = await editDuring(
        booking.id,
        // A fixture's change, written raw: the action only has to see another status.
        {
          sql: "UPDATE reservations SET reservation_status = 'ongoing' WHERE id = ?",
          values: [booking.id],
        },
        () => actions.updateReservation(booking.id, { items: [submitted(booking, 2)] }),
      );

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
      const after = await rowsOf(booking.id);
      assert.equal(after.items[0]?.quantity, 1);
      assert.deepEqual(after.activity, []);
    });

    test("a line added meanwhile: the edit is refused", async () => {
      const bikes = await product("Bike", 5);
      const helmets = await product("Helmet", 5);
      const booking = await reservation({ productId: bikes, quantity: 1 });

      const result = await editDuring(
        booking.id,
        {
          sql: `INSERT INTO reservation_items
                  (id, reservation_id, product_id, quantity, unit_price, deposit_per_unit, total_price, product_snapshot)
                VALUES (?, ?, ?, 1, '10.00', '0.00', '20.00', '{"name":"Helmet","description":null,"images":[]}')`,
          values: [nextId("itm"), booking.id, helmets],
        },
        () => actions.updateReservation(booking.id, { delivery: storeDelivery }),
      );

      assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
    });
  });

  test("two edits at once: one is written, the other is told to reload, and the total adds up", async () => {
    const bikes = await product("Bike", 5);
    const booking = await reservation(
      { productId: bikes, quantity: 1 },
      { deliveryFee: "15.00", discountAmount: "5.00" },
    );

    const results = await raceOnLockedRow(database, { table: "reservations", id: booking.id }, [
      // One raises the quantity and keeps the delivery fee it read…
      () => actions.updateReservation(booking.id, { items: [submitted(booking, 2)] }),
      // …the other moves both legs to the store, which drops the fee.
      () => actions.updateReservation(booking.id, { delivery: storeDelivery }),
    ]);

    assert.deepEqual(results.map((result) => result.error ?? "written").sort(), [
      "errors.reservationChangedMeanwhile",
      "written",
    ]);
    const { row, items, activity } = await rowsOf(booking.id);
    assert.ok(row);
    const lines = items.reduce((sum, item) => sum + Number(item.totalPrice), 0);
    assert.equal(Number(row.subtotalAmount), lines);
    assert.equal(
      Number(row.totalAmount),
      lines + Number(row.deliveryFee) - Number(row.discountAmount),
    );
    assert.equal(activity.length, 1);
    // Whichever won, it is one edit as a whole: 2 bikes with the fee, or 1 without.
    assert.ok(
      (items[0]?.quantity === 2 && row.totalAmount === "50.00") ||
        (items[0]?.quantity === 1 && row.totalAmount === "15.00"),
      `quantity ${items[0]?.quantity}, total ${row.totalAmount}`,
    );
  });

  test("an edit racing a new booking for the last unit: only one of them is written", async () => {
    const bikes = await product("Bike", 2);
    const booking = await reservation({ productId: bikes, quantity: 1 });

    const [edited, created] = await raceOnLockedRow(database, { table: "products", id: bikes }, [
      (): Promise<{ error?: string }> =>
        actions.updateReservation(booking.id, { items: [submitted(booking, 2)] }),
      (): Promise<{ error?: string }> =>
        actions.createManualReservation({
          customerId: "customer_edits",
          startDate: START,
          endDate: END,
          items: [{ productId: bikes, quantity: 1 }],
          sendConfirmationEmail: false,
        }),
    ]);

    assert.deepEqual([edited?.error ?? "written", created?.error ?? "written"].sort(), [
      "errors.insufficientCapacity",
      "written",
    ]);
    const booked = await louezDb.db
      .select({ quantity: louezDb.reservationItems.quantity })
      .from(louezDb.reservationItems)
      .innerJoin(
        louezDb.reservations,
        eq(louezDb.reservations.id, louezDb.reservationItems.reservationId),
      )
      .where(
        and(
          eq(louezDb.reservationItems.productId, bikes),
          inArray(louezDb.reservations.status, ["pending", "confirmed", "ongoing"]),
        ),
      );
    assert.equal(
      booked.reduce((sum, item) => sum + item.quantity, 0),
      2,
      "the two bikes are booked once each",
    );
  });
  describe("a product sold by size", () => {
    test("quantity moved to a size that is short is refused, then written with the override", async () => {
      // Two S and one L: the product's total stays three, the L asked twice.
      const wetsuits = await sizedProduct(["S", "S", "L"]);
      const booking = await sizedReservation(wetsuits.id, [
        { size: "S", quantity: 2 },
        { size: "L", quantity: 1 },
      ]);
      const [small, large] = booking.items;
      assert.ok(small && large);
      const before = await rowsOf(booking.id);
      const moved = {
        items: [submitted(small, 1, "Wetsuit"), submitted(large, 2, "Wetsuit")],
      };

      const refused = await actions.updateReservation(booking.id, moved);

      assert.deepEqual(refused, {
        error: "errors.insufficientCapacity",
        shortfalls: [
          {
            productId: wetsuits.id,
            productName: "Wetsuit",
            combinationKey: "size:L",
            requested: 2,
            available: 1,
          },
        ],
      });
      assert.deepEqual(await rowsOf(booking.id), before);

      const forced = await actions.updateReservation(booking.id, {
        ...moved,
        allowOverbooking: true,
      });

      assert.equal(forced.error, undefined);
      const [verdict] = await activityOf(booking.id);
      assert.equal(verdict?.overbooked, true);
    });

    test("a unit held by a line of no size is not promised again to a line of that size", async () => {
      // Two M and two L. The line of no size holds one M: one M is left.
      const wetsuits = await sizedProduct(["M", "M", "L", "L"]);
      const booking = await sizedReservation(wetsuits.id, [
        { quantity: 1, assignedUnitId: wetsuits.unitIds[0] },
        { size: "M", quantity: 1 },
      ]);
      const [anySize, medium] = booking.items;
      assert.ok(anySize && medium);

      const result = await actions.updateReservation(booking.id, {
        items: [submitted(anySize, 1, "Wetsuit"), submitted(medium, 2, "Wetsuit")],
      });

      assert.deepEqual(result, {
        error: "errors.insufficientCapacity",
        shortfalls: [
          {
            productId: wetsuits.id,
            productName: "Wetsuit",
            combinationKey: "size:M",
            requested: 2,
            available: 1,
          },
        ],
      });
    });

    test("dates moved onto a booking that chose the size alone find that size promised", async () => {
      // One red M, one blue M, one red L, sold by size and colour.
      const wetsuits = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: wetsuits,
        storeId: STORE,
        name: "Wetsuit",
        price: "10.00",
        pricingMode: "day",
        trackUnits: true,
        bookingAttributeAxes: [
          { key: "size", label: "Size", position: 0 },
          { key: "color", label: "Color", position: 1 },
        ],
        quantity: 3,
      });
      for (const [size, color] of [
        ["M", "red"],
        ["M", "blue"],
        ["L", "red"],
      ]) {
        await louezDb.db.insert(louezDb.productUnits).values({
          id: nextId("unt"),
          productId: wetsuits,
          identifier: `${size}-${color}`,
          attributes: { size, color },
          combinationKey: `size:${size}|color:${color}`,
        });
      }
      /** A line of the product on a booking, with the combination or the open choice given. */
      const choose = (
        booking: { itemId: string },
        choice: { combinationKey: string | null; selectedAttributes: Record<string, string> },
      ) =>
        louezDb.db
          .update(louezDb.reservationItems)
          .set(choice)
          .where(eq(louezDb.reservationItems.id, booking.itemId));
      // Two M of any colour are promised on the window.
      const anyMedium = await reservation({ productId: wetsuits, quantity: 2 });
      await choose(anyMedium, { combinationKey: null, selectedAttributes: { size: "M" } });
      // A red M booked five days later moves onto it.
      const later = {
        start: new Date(START.getTime() + 5 * DAY),
        end: new Date(END.getTime() + 5 * DAY),
      };
      const mediumRed = await reservation({ productId: wetsuits, quantity: 1 }, later);
      await choose(mediumRed, {
        combinationKey: "size:M|color:red",
        selectedAttributes: { size: "M", color: "red" },
      });
      const before = await rowsOf(mediumRed.id);
      const moved = { startDate: START, endDate: END };
      const short = {
        productId: wetsuits,
        productName: "Wetsuit",
        combinationKey: "size:M|color:red",
        requested: 1,
        available: 0,
      };

      // Three M would be out for the two the store has.
      assert.deepEqual(await actions.updateReservation(mediumRed.id, moved), {
        error: "errors.insufficientCapacity",
        shortfalls: [short],
      });
      assert.deepEqual(await rowsOf(mediumRed.id), before);

      const forced = await actions.updateReservation(mediumRed.id, {
        ...moved,
        allowOverbooking: true,
      });
      assert.equal(forced.error, undefined);
      const [verdict] = await activityOf(mediumRed.id);
      assert.deepEqual([verdict?.overbooked, verdict?.overbookingShortfalls], [true, [short]]);
      assert.ok((await overbookedInInbox()).includes(mediumRed.id));
    });

    test("a line added with no size is served by units of every size", async () => {
      // Two S and one L cover three units of any size: no override is asked.
      const wetsuits = await sizedProduct(["S", "S", "L"]);
      const helmets = await product("Helmet", 5);
      const booking = await reservation({ productId: helmets, quantity: 1 });

      const result = await actions.updateReservation(booking.id, {
        items: [submitted(booking, 1, "Helmet"), added(wetsuits.id, 3, "Wetsuit")],
      });

      assert.equal(result.error, undefined);
      const [verdict] = await activityOf(booking.id);
      assert.equal(verdict?.overbooked, false);
    });
  });
});

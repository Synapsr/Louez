import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ReserveInventoryLine } from "./reservation-inventory";

// The stock check of a booking on a migrated database: by default it stops at
// the first line that does not fit; asked to collect, it lists every line the
// stock cannot cover and still allocates the others.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

const START = new Date("2031-05-10T09:00:00.000Z");
const END = new Date("2031-05-12T09:00:00.000Z");
const SIZE_AXIS = [{ key: "size", label: "Size", position: 0 }];

describe("reserveInventory (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let inventory: typeof import("./reservation-inventory");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("reservation_inventory");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    inventory = await import("./reservation-inventory");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  /** A product counted by quantity, in a store of its own. */
  async function countedProduct(quantity: number) {
    const storeId = nextId("store");
    const productId = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId,
      name: "Bike",
      price: "10.00",
      pricingMode: "day",
      quantity,
    });
    return { storeId, productId };
  }

  /** A product sold by size, with one unit per given size, in a store of its own. */
  async function sizedProduct(sizes: string[]) {
    const storeId = nextId("store");
    const productId = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId,
      name: "Wetsuit",
      price: "10.00",
      pricingMode: "day",
      trackUnits: true,
      bookingAttributeAxes: SIZE_AXIS,
      quantity: sizes.length,
    });
    const unitIds: string[] = [];
    for (const [index, size] of sizes.entries()) {
      const unitId = nextId("unt");
      unitIds.push(unitId);
      await louezDb.db.insert(louezDb.productUnits).values({
        id: unitId,
        productId,
        identifier: `W-${index + 1}`,
        attributes: { size },
        combinationKey: `size:${size}`,
      });
    }
    return { storeId, productId, unitIds };
  }

  /** Another confirmed booking over the same window. */
  async function otherBooking(
    storeId: string,
    line: { productId: string; quantity: number; combinationKey?: string },
  ) {
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: "confirmed",
      startDate: START,
      endDate: END,
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: id,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "10.00",
      combinationKey: line.combinationKey ?? null,
      productSnapshot: { name: "Line", description: null, images: [] },
    });
  }

  const check = (storeId: string, lines: ReserveInventoryLine[], onShortfall: "fail" | "collect") =>
    louezDb.db.transaction(async (tx) => {
      const lockedProductsById = await inventory.lockReservationProducts(
        tx,
        storeId,
        lines.map((line) => line.productId),
      );
      const input = {
        tx,
        storeId,
        lockedProductsById,
        lines,
        window: { start: START, end: END },
        turnoverBufferMinutes: 0,
        blockingStatuses: louezDb.getBlockingReservationStatuses(true),
      };
      return onShortfall === "collect"
        ? inventory.reserveInventory({ ...input, onShortfall: "collect" })
        : inventory.reserveInventory(input);
    });

  /** The collected shortfalls of a check that went through. */
  async function shortfallsOf(storeId: string, lines: ReserveInventoryLine[]) {
    const result = await check(storeId, lines, "collect");
    assert.ok(result.ok && "shortfalls" in result);
    return result.shortfalls;
  }

  const refused = { ok: false, error: "errors.productNoLongerAvailable" };

  test("a counted product reports what the other bookings leave", async () => {
    const { storeId, productId } = await countedProduct(2);
    await otherBooking(storeId, { productId, quantity: 1 });
    const lines = [{ productId, quantity: 3 }];

    assert.deepEqual(await shortfallsOf(storeId, lines), [
      { productId, productName: "Bike", combinationKey: null, requested: 3, available: 1 },
    ]);
    assert.deepEqual(await check(storeId, lines, "fail"), { ...refused, params: { name: "Bike" } });
  });

  test("two lines on the same product share what is left, in their order", async () => {
    const { storeId, productId } = await countedProduct(2);

    assert.deepEqual(
      await shortfallsOf(storeId, [
        { productId, quantity: 2 },
        { productId, quantity: 1 },
      ]),
      [{ productId, productName: "Bike", combinationKey: null, requested: 1, available: 0 }],
    );
    assert.deepEqual(
      await shortfallsOf(storeId, [
        { productId, quantity: 3 },
        { productId, quantity: 1 },
      ]),
      [
        { productId, productName: "Bike", combinationKey: null, requested: 3, available: 2 },
        { productId, productName: "Bike", combinationKey: null, requested: 1, available: 0 },
      ],
    );
  });

  test("a line that chose a combination reports that combination", async () => {
    const { storeId, productId } = await sizedProduct(["M", "L"]);
    const lines = [
      { lineId: "chosen", productId, quantity: 2, combinationKey: "size:M" },
      { lineId: "fits", productId, quantity: 1, combinationKey: "size:L" },
    ];

    const result = await check(storeId, lines, "collect");
    assert.ok(result.ok && "shortfalls" in result);
    assert.deepEqual(result.shortfalls, [
      { productId, productName: "Wetsuit", combinationKey: "size:M", requested: 2, available: 1 },
    ]);
    // The short line took the M unit; the other line is still allocated.
    assert.equal(
      result.inventory.resolvedCombinationByLineKey.get("chosen")?.combinationKey,
      "size:M",
    );
    assert.equal(
      result.inventory.resolvedCombinationByLineKey.get("fits")?.combinationKey,
      "size:L",
    );
    assert.deepEqual(await check(storeId, lines, "fail"), {
      ...refused,
      params: { name: "Wetsuit" },
    });
  });

  test("a pooled line reports the units left on the whole product", async () => {
    const { storeId, productId } = await sizedProduct(["M", "L"]);
    const lines = [{ productId, quantity: 3, combinationKey: "__default" }];

    assert.deepEqual(await shortfallsOf(storeId, lines), [
      { productId, productName: "Wetsuit", combinationKey: null, requested: 3, available: 2 },
    ]);
    assert.deepEqual(await check(storeId, lines, "fail"), {
      ...refused,
      params: { name: "Wetsuit" },
    });
  });

  test("a held unit whose combination is taken is short, and the rest still floats", async () => {
    const {
      storeId,
      productId,
      unitIds: [mediumUnit],
    } = await sizedProduct(["M", "L"]);
    assert.ok(mediumUnit);
    // Another booking owns the only M: the M unit this line holds does not fit.
    await otherBooking(storeId, { productId, quantity: 1, combinationKey: "size:M" });
    const lines = [
      { productId, quantity: 2, combinationKey: "__default", assignedUnitIds: [mediumUnit] },
    ];

    assert.deepEqual(await shortfallsOf(storeId, lines), [
      { productId, productName: "Wetsuit", combinationKey: null, requested: 2, available: 1 },
    ]);
    assert.deepEqual(await check(storeId, lines, "fail"), {
      ...refused,
      params: { name: "Wetsuit" },
    });
  });

  test("a held unit that fits is kept, and the line is short of what floats", async () => {
    const {
      storeId,
      productId,
      unitIds: [mediumUnit],
    } = await sizedProduct(["M", "L"]);
    assert.ok(mediumUnit);
    await otherBooking(storeId, { productId, quantity: 1, combinationKey: "size:L" });
    const lines = [
      { productId, quantity: 2, combinationKey: "__default", assignedUnitIds: [mediumUnit] },
    ];

    assert.deepEqual(await shortfallsOf(storeId, lines), [
      { productId, productName: "Wetsuit", combinationKey: null, requested: 2, available: 1 },
    ]);
  });

  test("a cart that fits answers the same in both modes, with no shortfall", async () => {
    const { storeId, productId } = await sizedProduct(["M", "L"]);
    const lines = [
      { lineId: "a", productId, quantity: 1, combinationKey: "size:L" },
      { lineId: "b", productId, quantity: 1, combinationKey: "__default" },
    ];

    const strict = await check(storeId, lines, "fail");
    const collected = await check(storeId, lines, "collect");
    assert.ok(strict.ok && collected.ok && "shortfalls" in collected);
    assert.deepEqual(Object.keys(strict), ["ok", "inventory"]);
    assert.deepEqual(collected.shortfalls, []);
    assert.deepEqual(
      [...collected.inventory.resolvedCombinationByLineKey],
      [...strict.inventory.resolvedCombinationByLineKey],
    );
    assert.deepEqual(
      [...strict.inventory.resolvedCombinationByLineKey],
      [
        ["a", { combinationKey: "size:L", selectedAttributes: { size: "L" } }],
        ["b", { combinationKey: "__default", selectedAttributes: {} }],
      ],
    );
  });

  test("a product of another store is not found, in both modes", async () => {
    const { productId } = await countedProduct(2);
    const { storeId } = await countedProduct(2);
    const lines = [{ productId, quantity: 1 }];

    const notFound = { ok: false, error: "errors.productNotFound" };
    assert.deepEqual(await check(storeId, lines, "fail"), notFound);
    assert.deepEqual(await check(storeId, lines, "collect"), notFound);
  });

  describe("an existing reservation checked before it takes its stock", () => {
    /** A quote of one line of the product, in a store that has its row. */
    async function quoteOf(
      storeId: string,
      line: { productId: string; quantity: number; combinationKey: string | null },
    ) {
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: storeId, userId: storeId, name: storeId, slug: storeId });
      const id = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId,
        customerId: "customer",
        number: id,
        status: "quote",
        startDate: START,
        endDate: END,
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("itm"),
        reservationId: id,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        combinationKey: line.combinationKey,
        productSnapshot: { name: "Line", description: null, images: [] },
      });
      return id;
    }

    const checkExisting = (storeId: string, reservationId: string) =>
      louezDb.db.transaction((tx) =>
        inventory.checkExistingReservationInventory(tx, reservationId, storeId),
      );

    test("a line of no size is served by units of every size", async () => {
      // Two S and one L cover three units of any size, as when the line was booked.
      const { storeId, productId } = await sizedProduct(["S", "S", "L"]);
      const quote = await quoteOf(storeId, { productId, quantity: 3, combinationKey: null });

      await checkExisting(storeId, quote);
    });

    test("a line of no size past every unit is refused", async () => {
      const { storeId, productId } = await sizedProduct(["S", "S", "L"]);
      const quote = await quoteOf(storeId, { productId, quantity: 4, combinationKey: null });

      await assert.rejects(checkExisting(storeId, quote), /errors\.productNoLongerAvailable/);
    });

    test("a line that chose a size is held to that size", async () => {
      const { storeId, productId } = await sizedProduct(["S", "S", "L"]);
      const quote = await quoteOf(storeId, { productId, quantity: 2, combinationKey: "size:L" });

      await assert.rejects(checkExisting(storeId, quote), /errors\.productNoLongerAvailable/);
    });
  });
});

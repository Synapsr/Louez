import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { UnitAttributes } from "@louez/types";

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
const HOUR = 3_600_000;
const SIZE_AXIS = [{ key: "size", label: "Size", position: 0 }];
const SIZE_AND_COLOR = [...SIZE_AXIS, { key: "color", label: "Color", position: 1 }];
const M_RED = "size:M|color:red";
const M_BLUE = "size:M|color:blue";
const L_RED = "size:L|color:red";

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

  /**
   * A product with tracked units sold by the given axes, in a store of its
   * own. Each unit carries its values and the combination key they give,
   * unless it is given another key.
   */
  async function trackedProduct(
    axes: typeof SIZE_AND_COLOR,
    units: Array<{ attributes: UnitAttributes; combinationKey?: string }>,
  ) {
    const storeId = nextId("store");
    const productId = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId,
      name: "Wetsuit",
      price: "10.00",
      pricingMode: "day",
      trackUnits: true,
      bookingAttributeAxes: axes,
      quantity: units.length,
    });
    const unitIds: string[] = [];
    for (const [index, unit] of units.entries()) {
      const unitId = nextId("unt");
      unitIds.push(unitId);
      await louezDb.db.insert(louezDb.productUnits).values({
        id: unitId,
        productId,
        identifier: `W-${index + 1}`,
        attributes: unit.attributes,
        combinationKey:
          unit.combinationKey ??
          axes.map((axis) => `${axis.key}:${unit.attributes[axis.key]}`).join("|"),
      });
    }
    return { storeId, productId, unitIds };
  }

  /** A product sold by size, with one unit per given size. */
  const sizedProduct = (sizes: string[]) =>
    trackedProduct(
      SIZE_AXIS,
      sizes.map((size) => ({ attributes: { size } })),
    );

  /** One red M, one blue M and one red L, sold by size and colour. */
  const sizedAndColoured = () =>
    trackedProduct(SIZE_AND_COLOR, [
      { attributes: { size: "M", color: "red" } },
      { attributes: { size: "M", color: "blue" } },
      { attributes: { size: "L", color: "red" } },
    ]);

  /** Another booking of one line: confirmed and over the same window, unless told otherwise. */
  async function otherBooking(
    storeId: string,
    line: {
      productId: string;
      quantity: number;
      combinationKey?: string;
      selectedAttributes?: UnitAttributes;
      assignedUnitId?: string;
    },
    options: { status?: "pending" | "confirmed" | "ongoing"; start?: Date; end?: Date } = {},
  ) {
    const id = nextId("res");
    const itemId = nextId("itm");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: options.status ?? "confirmed",
      startDate: options.start ?? START,
      endDate: options.end ?? END,
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId: id,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "10.00",
      combinationKey: line.combinationKey ?? null,
      selectedAttributes: line.selectedAttributes ?? null,
      productSnapshot: { name: "Line", description: null, images: [] },
    });
    if (line.assignedUnitId) {
      await louezDb.db.insert(louezDb.reservationItemUnits).values({
        id: nextId("asg"),
        reservationItemId: itemId,
        productUnitId: line.assignedUnitId,
        identifierSnapshot: "W",
      });
    }
    return { id, itemId };
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
  const refusedWetsuit = { ...refused, params: { name: "Wetsuit" } };
  const short = (
    productId: string,
    combinationKey: string | null,
    requested: number,
    available: number,
  ) => ({ productId, productName: "Wetsuit", combinationKey, requested, available });

  /** The combination each line of a check that went through resolved to. */
  async function resolvedBy(storeId: string, lines: ReserveInventoryLine[]) {
    const result = await check(storeId, lines, "fail");
    assert.ok(result.ok, JSON.stringify(result));
    return [...result.inventory.resolvedCombinationByLineKey.values()];
  }

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

  describe("another booking that left a choice open", () => {
    test("is counted on the units of the size it chose, whatever their colour", async () => {
      // Two M are promised to a booking that chose no colour: three M would be
      // out for the two there are.
      const { storeId, productId } = await sizedAndColoured();
      await otherBooking(storeId, { productId, quantity: 2, selectedAttributes: { size: "M" } });
      const mediumRed = [{ productId, quantity: 1, combinationKey: M_RED }];

      assert.deepEqual(await check(storeId, mediumRed, "fail"), refusedWetsuit);
      assert.deepEqual(await shortfallsOf(storeId, mediumRed), [short(productId, M_RED, 1, 0)]);
      // A cart line that chose the size alone finds no M either.
      assert.deepEqual(
        await check(
          storeId,
          [{ productId, quantity: 1, selectedAttributes: { size: "M" } }],
          "fail",
        ),
        refusedWetsuit,
      );
      // The L is not one of them.
      assert.deepEqual(
        await resolvedBy(storeId, [{ productId, quantity: 1, combinationKey: L_RED }]),
        [{ combinationKey: L_RED, selectedAttributes: { size: "L", color: "red" } }],
      );
    });

    test("leaves a cart line the combination it does not need", async () => {
      // Both red units are promised to a booking that chose the colour alone.
      const { storeId, productId } = await sizedAndColoured();
      await otherBooking(storeId, { productId, quantity: 2, selectedAttributes: { color: "red" } });

      // The first combination in order is the red L: the line resolves past it.
      assert.deepEqual(await resolvedBy(storeId, [{ productId, quantity: 1 }]), [
        { combinationKey: M_BLUE, selectedAttributes: { size: "M", color: "blue" } },
      ]);
      assert.deepEqual(await check(storeId, [{ productId, quantity: 2 }], "fail"), refusedWetsuit);
    });

    test("and overlaps another open choice: both are placed before the request", async () => {
      // "M" and "red" share the red M. Together they leave one unit, and
      // which one depends on what the request asks.
      const { storeId, productId } = await sizedAndColoured();
      await otherBooking(storeId, { productId, quantity: 1, selectedAttributes: { size: "M" } });
      await otherBooking(storeId, { productId, quantity: 1, selectedAttributes: { color: "red" } });

      for (const combinationKey of [M_RED, M_BLUE, L_RED]) {
        assert.equal(
          (await check(storeId, [{ productId, quantity: 1, combinationKey }], "fail")).ok,
          true,
        );
      }
      assert.deepEqual(
        await shortfallsOf(storeId, [
          { productId, quantity: 1, combinationKey: M_RED },
          { productId, quantity: 1, combinationKey: L_RED },
        ]),
        [short(productId, L_RED, 1, 0)],
      );
    });

    test("holds a unit: it counts on that unit's combination", async () => {
      const {
        storeId,
        productId,
        unitIds: [mediumRed],
      } = await sizedAndColoured();
      await otherBooking(storeId, { productId, quantity: 1, assignedUnitId: mediumRed });

      assert.deepEqual(
        await shortfallsOf(storeId, [
          { productId, quantity: 2, selectedAttributes: { size: "M" }, pooled: true },
        ]),
        [short(productId, null, 2, 1)],
      );
    });

    test("chose a value on an axis the product dropped since: the value no longer counts", async () => {
      // Booked as "M, red" with no exact combination; the product is now sold by size alone.
      const { storeId, productId } = await sizedProduct(["M", "M", "L"]);
      await otherBooking(storeId, {
        productId,
        quantity: 2,
        selectedAttributes: { size: "M", color: "red" },
      });

      assert.deepEqual(
        await check(storeId, [{ productId, quantity: 1, combinationKey: "size:M" }], "fail"),
        refusedWetsuit,
      );
      assert.equal(
        (await check(storeId, [{ productId, quantity: 1, combinationKey: "size:L" }], "fail")).ok,
        true,
      );
    });
  });

  describe("other bookings the stock cannot serve", () => {
    test("booked over a size leave the other sizes free", async () => {
      // Two bookings for the one M: the L is no use to them.
      const { storeId, productId } = await sizedProduct(["M", "L"]);
      await otherBooking(storeId, { productId, quantity: 2, combinationKey: "size:M" });

      assert.equal(
        (await check(storeId, [{ productId, quantity: 1, combinationKey: "size:L" }], "fail")).ok,
        true,
      );
      assert.deepEqual(
        await check(storeId, [{ productId, quantity: 1, combinationKey: "size:M" }], "fail"),
        refusedWetsuit,
      );
    });

    test("booked over the product with no size leave nothing", async () => {
      const { storeId, productId } = await sizedProduct(["M", "L"]);
      await otherBooking(storeId, { productId, quantity: 3 });

      assert.deepEqual(
        await check(storeId, [{ productId, quantity: 1, combinationKey: "size:L" }], "fail"),
        refusedWetsuit,
      );
    });

    test("on a size no rentable unit carries ask nothing of the other sizes", async () => {
      const { storeId, productId } = await sizedProduct(["M", "L"]);
      await otherBooking(storeId, { productId, quantity: 1, combinationKey: "size:S" });

      assert.deepEqual(
        await shortfallsOf(storeId, [{ productId, quantity: 2, combinationKey: "__default" }]),
        [],
      );
      // And a line on that size is short of everything.
      assert.deepEqual(
        await shortfallsOf(storeId, [{ productId, quantity: 1, combinationKey: "size:S" }]),
        [short(productId, "size:S", 1, 0)],
      );
    });
  });

  describe("bookings on other days of the window", () => {
    test("share a unit, and the request keeps its own for the whole window", async () => {
      // An M out the first morning, a unit of any size out the second day.
      const { storeId, productId } = await sizedProduct(["M", "L"]);
      await otherBooking(
        storeId,
        { productId, quantity: 1, combinationKey: "size:M" },
        { start: START, end: new Date(START.getTime() + 6 * HOUR) },
      );
      await otherBooking(
        storeId,
        { productId, quantity: 1 },
        { start: new Date(START.getTime() + 24 * HOUR), end: END },
      );

      // The M serves both in turn: the L is free from start to end.
      assert.equal(
        (await check(storeId, [{ productId, quantity: 1, combinationKey: "size:L" }], "fail")).ok,
        true,
      );
      // The M is not, though no instant has both units out.
      assert.deepEqual(
        await shortfallsOf(storeId, [{ productId, quantity: 2, combinationKey: "__default" }]),
        [short(productId, null, 2, 1)],
      );
      assert.deepEqual(
        await check(storeId, [{ productId, quantity: 1, combinationKey: "size:M" }], "fail"),
        refusedWetsuit,
      );
    });
  });

  describe("a unit that is out of the stock over the window", () => {
    /** Two M, the first retired and held by another booking's line of that size. */
    async function retiredUnitHeldBy(status: "confirmed" | "ongoing") {
      const product = await sizedProduct(["M", "M"]);
      const [retired] = product.unitIds;
      assert.ok(retired);
      await louezDb.db
        .update(louezDb.productUnits)
        .set({ lifecycleStatus: "retired" })
        .where(eq(louezDb.productUnits.id, retired));
      await otherBooking(
        product.storeId,
        {
          productId: product.productId,
          quantity: 1,
          combinationKey: "size:M",
          assignedUnitId: retired,
        },
        { status },
      );
      return product;
    }
    const oneMedium = (productId: string) => [{ productId, quantity: 1, combinationKey: "size:M" }];

    test("and out with an ongoing rental takes that rental off the count", async () => {
      // The retired unit is with the customer: the other M is free.
      const { storeId, productId } = await retiredUnitHeldBy("ongoing");

      assert.equal((await check(storeId, oneMedium(productId), "fail")).ok, true);
    });

    test("and held by a booking yet to start leaves that booking counted", async () => {
      // The booking will need another M: the one left is its.
      const { storeId, productId } = await retiredUnitHeldBy("confirmed");

      assert.deepEqual(await check(storeId, oneMedium(productId), "fail"), refusedWetsuit);
    });
  });

  describe("units whose keys predate an axis change", () => {
    /** Sold by size alone now; the units still carry their size-and-colour keys. */
    const staleKeys = () =>
      trackedProduct(SIZE_AXIS, [
        { attributes: { size: "M", color: "red" }, combinationKey: M_RED },
        { attributes: { size: "M", color: "blue" }, combinationKey: M_BLUE },
        { attributes: { size: "L", color: "red" }, combinationKey: L_RED },
      ]);
    const mediums = (productId: string, quantity: number) => [
      { productId, quantity, selectedAttributes: { size: "M" }, pooled: true },
    ];

    test("serve a line by the size they carry", async () => {
      const { storeId, productId } = await staleKeys();

      assert.deepEqual(await shortfallsOf(storeId, mediums(productId, 2)), []);
      assert.deepEqual(await shortfallsOf(storeId, mediums(productId, 3)), [
        short(productId, null, 3, 2),
      ]);
    });

    test("are counted for another booking's open choice, and for the unit it holds", async () => {
      const {
        storeId,
        productId,
        unitIds: [mediumRed],
      } = await staleKeys();
      await otherBooking(storeId, { productId, quantity: 1, selectedAttributes: { size: "M" } });
      await otherBooking(storeId, { productId, quantity: 1, assignedUnitId: mediumRed });

      assert.deepEqual(await shortfallsOf(storeId, mediums(productId, 1)), [
        short(productId, null, 1, 0),
      ]);
      assert.deepEqual(
        await shortfallsOf(storeId, [{ productId, quantity: 1, combinationKey: "__default" }]),
        [],
      );
    });

    test("do not answer to the key the current axes give, until they are rekeyed", async () => {
      const { storeId, productId } = await staleKeys();

      assert.deepEqual(
        await shortfallsOf(storeId, [{ productId, quantity: 1, combinationKey: "size:M" }]),
        [short(productId, "size:M", 1, 0)],
      );
    });
  });

  test("a product of two hundred units is checked next to three hundred overlapping lines", async (t) => {
    // Twenty combinations of ten units. The other bookings start and end all
    // over the window; half chose a combination, the others left a choice open.
    const sizes = ["S", "M", "L", "XL"];
    const colors = ["red", "blue", "green", "black", "white"];
    const { storeId, productId } = await trackedProduct(
      SIZE_AND_COLOR,
      sizes.flatMap((size) =>
        colors.flatMap((color) =>
          Array.from({ length: 10 }, () => ({ attributes: { size, color } })),
        ),
      ),
    );
    // A fixed sequence, so the test asks the same thing every run.
    let state = 7;
    const next = (below: number) => {
      state = (state * 48271) % 2147483647;
      return state % below;
    };
    const reservationRows = [];
    const itemRows = [];
    for (let index = 0; index < 300; index += 1) {
      const id = nextId("res");
      const start = START.getTime() + next(40) * HOUR;
      const size = sizes[next(sizes.length)] ?? "S";
      const color = colors[next(colors.length)] ?? "red";
      const kind = next(20);
      reservationRows.push({
        id,
        storeId,
        customerId: "customer",
        number: id,
        status: "confirmed" as const,
        startDate: new Date(start),
        endDate: new Date(start + (2 + next(20)) * HOUR),
        subtotalAmount: "10.00",
        depositAmount: "0.00",
        totalAmount: "10.00",
      });
      itemRows.push({
        id: nextId("itm"),
        reservationId: id,
        productId,
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        combinationKey: kind < 10 ? `size:${size}|color:${color}` : null,
        selectedAttributes:
          kind < 10 ? { size, color } : kind < 15 ? { size } : kind < 18 ? { color } : null,
        productSnapshot: { name: "Line", description: null, images: [] },
      });
    }
    await louezDb.db.insert(louezDb.reservations).values(reservationRows);
    await louezDb.db.insert(louezDb.reservationItems).values(itemRows);
    const lines: ReserveInventoryLine[] = [
      { productId, quantity: 4, combinationKey: "size:M|color:red" },
      { productId, quantity: 6, selectedAttributes: { size: "L" } },
      { productId, quantity: 30, selectedAttributes: { size: "S" }, pooled: true },
      { productId, quantity: 25, selectedAttributes: { color: "blue" }, pooled: true },
      { productId, quantity: 200, pooled: true },
    ];

    const startedAt = performance.now();
    const shortfalls = await shortfallsOf(storeId, lines);
    t.diagnostic(`collect mode: ${Math.round(performance.now() - startedAt)} ms`);

    // The blue units run out, then the product: each line takes what is left.
    assert.deepEqual(shortfalls, [short(productId, null, 25, 15), short(productId, null, 200, 55)]);
    // What they took fits whole, and one more unit of any kind does not.
    const fitting = [
      ...lines.slice(0, 3),
      { ...lines[3], productId, quantity: 15 },
      { ...lines[4], productId, quantity: 55 },
    ];
    const fittedAt = performance.now();
    assert.equal((await check(storeId, fitting, "fail")).ok, true);
    t.diagnostic(`default mode: ${Math.round(performance.now() - fittedAt)} ms`);
    assert.deepEqual(
      await check(storeId, [...fitting, { productId, quantity: 1, pooled: true }], "fail"),
      refusedWetsuit,
    );
    // A cart of one unit, as a checkout sends it.
    const cartAt = performance.now();
    assert.equal(
      (
        await check(
          storeId,
          [{ productId, quantity: 1, selectedAttributes: { size: "M" } }],
          "fail",
        )
      ).ok,
      true,
    );
    t.diagnostic(`a cart of one unit: ${Math.round(performance.now() - cartAt)} ms`);
  });

  describe("an existing reservation checked before it takes its stock", () => {
    /** A quote of one line of the product, in a store that has its row. */
    async function quoteOf(
      storeId: string,
      line: {
        productId: string;
        quantity: number;
        combinationKey: string | null;
        assignedUnitIds?: string[];
      },
      settings: { turnoverBufferMinutes?: number } = {},
    ) {
      await louezDb.db.insert(louezDb.stores).values({
        id: storeId,
        userId: storeId,
        name: storeId,
        slug: storeId,
        settings: { reservationMode: "request", advanceNoticeMinutes: 0, ...settings },
      });
      const id = nextId("res");
      const itemId = nextId("itm");
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
        id: itemId,
        reservationId: id,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        combinationKey: line.combinationKey,
        productSnapshot: { name: "Line", description: null, images: [] },
      });
      for (const unitId of line.assignedUnitIds ?? []) {
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: nextId("asg"),
          reservationItemId: itemId,
          productUnitId: unitId,
          identifierSnapshot: "kept name",
        });
      }
      return { id, itemId };
    }

    const checkExisting = (storeId: string, reservationId: string) =>
      louezDb.db.transaction((tx) =>
        inventory.checkExistingReservationInventory(tx, reservationId, storeId),
      );

    test("a line of no size is served by units of every size", async () => {
      // Two S and one L cover three units of any size, as when the line was booked.
      const { storeId, productId } = await sizedProduct(["S", "S", "L"]);
      const quote = await quoteOf(storeId, { productId, quantity: 3, combinationKey: null });

      await checkExisting(storeId, quote.id);
    });

    test("a line of no size past every unit is refused", async () => {
      const { storeId, productId } = await sizedProduct(["S", "S", "L"]);
      const quote = await quoteOf(storeId, { productId, quantity: 4, combinationKey: null });

      await assert.rejects(checkExisting(storeId, quote.id), /errors\.productNoLongerAvailable/);
    });

    test("a line that chose a size is held to that size", async () => {
      const { storeId, productId } = await sizedProduct(["S", "S", "L"]);
      const quote = await quoteOf(storeId, { productId, quantity: 2, combinationKey: "size:L" });

      await assert.rejects(checkExisting(storeId, quote.id), /errors\.productNoLongerAvailable/);
    });
  });
});

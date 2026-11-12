import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";
import type { StoreSettings, UnitAttributes } from "@louez/types";
import { buildCombinationKey } from "@louez/utils";

import { STORE_KEY } from "./actions-test-stubs";

// A booking typed in the dashboard, on a migrated database: what stock it is
// checked against, when it is refused with its shortfalls, what it writes when
// the store books over them, and what each line keeps of the size it chose.

const STORE = "store_creations";
const CUSTOMER = "customer_creations";
const MINUTE = 60_000;
const DAY = 86_400_000;
const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date(START.getTime() + 2 * DAY);
const SETTINGS: StoreSettings = {
  reservationMode: "request",
  advanceNoticeMinutes: 0,
  currency: "eur",
};
/** What the marketplace's checkout proves it is with. */
const MARKETPLACE_SECRET = "test-marketplace-secret";

// The insurer, as the action sees it: connected with a quote of the amount a
// test puts under this key, and not connected while it holds none.
const INSURANCE_QUOTE_KEY = "__louezCreationTestInsuranceQuote";
const quoted = `globalThis[${JSON.stringify(INSURANCE_QUOTE_KEY)}]`;
const INSURER_STUBS: Record<string, string> = {
  "@/lib/integrations/tulip/state": `export async function resolveTulipIntegrationForStore() {
    const enabled = ${quoted} != null;
    return { settings: { enabled, connectedAt: null, publicMode: enabled ? "optional" : "no_public", renterUid: null } };
  }\n`,
  "@/lib/integrations/tulip/contracts": `export async function previewTulipQuoteForCheckout({ items }) {
    return { shouldApply: true, amount: ${quoted}, inclusionEnabled: false, insuredProductCount: items.length, uninsuredProductCount: 0, insuredProductIds: items.map((item) => item.productId) };
  }
  export async function getTulipCoverageSummary() { return { insuredProductCount: 0, uninsuredProductCount: 0, insuredProductIds: [] }; }
  export async function createTulipContractForReservation() {}
  export async function syncTulipContractForReservation() {}\n`,
};
const INSURER_SCHEME = "louez-creation-test-insurer:";
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
    if (parent.endsWith("/dashboard/reservations/actions.ts") && specifier in INSURER_STUBS) {
      return { shortCircuit: true, url: `${INSURER_SCHEME}${specifier}` };
    }
    return next(specifier, context);
  },
  load(url: string, context: unknown, next: (url: string, context: unknown) => unknown) {
    if (!url.startsWith(INSURER_SCHEME)) return next(url, context);
    return {
      shortCircuit: true,
      format: "module",
      source: INSURER_STUBS[url.slice(INSURER_SCHEME.length)],
    };
  },
});

type CompetingStatus =
  | "pending"
  | "quote"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "rejected"
  | "declined";

describe("createManualReservation (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let checkout: typeof import("@/lib/reservations/create-reservation");
  let inbox: typeof import("@louez/api/services/inbox");
  let counter = 0;
  const savedMarketplaceSecret = process.env.MARKETPLACE_CATALOG_SECRET;

  /** What the session holds of the store: the action reads it before its locks. */
  const useSession = (settings: StoreSettings) =>
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      // No user id: analytics skips the event.
      userId: "",
      name: "Creations",
      slug: "creations",
      address: null,
      settings,
      stripeAccountId: null,
    });

  /** The store's settings, on its row and in the session the action reads. */
  async function useStore(settings: Partial<StoreSettings> = {}) {
    const merged = { ...SETTINGS, ...settings };
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: merged })
      .where(eq(louezDb.stores.id, STORE));
    useSession(merged);
  }

  /** Runs with other settings, then puts the store back. */
  async function withSettings<T>(settings: Partial<StoreSettings>, run: () => Promise<T>) {
    await useStore(settings);
    try {
      return await run();
    } finally {
      await useStore();
    }
  }

  before(async () => {
    database = await createTestDatabase("create_manual_reservation");
    // Read once, when the app's environment loads.
    process.env.MARKETPLACE_CATALOG_SECRET = MARKETPLACE_SECRET;
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    checkout = await import("@/lib/reservations/create-reservation");
    // packages/api is ES modules: its services need the CommonJS packages'
    // names by hand. Loaded last, as the mocks change how later modules load.
    await import("@louez/mcp/testing/cjs-named-exports");
    inbox = await import("@louez/api/services/inbox");

    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "owner_creations", name: "Creations", slug: "creations" });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
    await useStore();
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    if (savedMarketplaceSecret === undefined) delete process.env.MARKETPLACE_CATALOG_SECRET;
    else process.env.MARKETPLACE_CATALOG_SECRET = savedMarketplaceSecret;
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  // 21 characters, as nanoid ids: the unit assignment checks their shape.
  const nextId = (prefix: string) =>
    `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

  /** A product counted by quantity, at 10.00 a day. */
  async function product(
    name: string,
    quantity: number,
    stockKind: "returnable" | "consumable" | "untracked" = "returnable",
  ) {
    const id = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: STORE,
      name,
      price: "10.00",
      pricingMode: "day",
      quantity,
      stockKind,
    });
    return id;
  }

  /**
   * A product with tracked units, one per given set of values. With axes it is
   * sold by them ("size", or "size" and "color"); with none, any unit serves.
   */
  async function trackedProduct(units: UnitAttributes[], axisKeys: string[] = ["size"]) {
    const id = nextId("prd");
    const axes = axisKeys.map((key, position) => ({ key, label: key, position }));
    await louezDb.db.insert(louezDb.products).values({
      id,
      storeId: STORE,
      name: "Wetsuit",
      price: "10.00",
      pricingMode: "day",
      trackUnits: true,
      bookingAttributeAxes: axes.length > 0 ? axes : null,
      quantity: units.length,
    });
    const unitIds: string[] = [];
    for (const [index, attributes] of units.entries()) {
      const unitId = nextId("unt");
      unitIds.push(unitId);
      await louezDb.db.insert(louezDb.productUnits).values({
        id: unitId,
        productId: id,
        identifier: `W-${index + 1}`,
        attributes: axes.length > 0 ? attributes : null,
        combinationKey: buildCombinationKey(axes, attributes),
      });
    }
    return { id, unitIds };
  }

  const sized = (...sizes: string[]) => trackedProduct(sizes.map((size) => ({ size })));

  /** Another reservation of one line of the product: a fixture, in any status. */
  async function booked(
    productId: string,
    quantity: number,
    options: {
      status?: CompetingStatus;
      start?: Date;
      end?: Date;
      source?: string;
      size?: string;
      /** What the line chose with no exact combination: any unit that matches serves it. */
      chosen?: UnitAttributes;
      assignedUnitId?: string;
    } = {},
  ) {
    const id = nextId("res");
    const itemId = nextId("itm");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status: options.status ?? "confirmed",
      startDate: options.start ?? START,
      endDate: options.end ?? END,
      subtotalAmount: "20.00",
      depositAmount: "0.00",
      totalAmount: "20.00",
      source: options.source ?? "manual",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId: id,
      productId,
      quantity,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "20.00",
      productSnapshot: { name: "Line", description: null, images: [] },
      combinationKey: options.size ? `size:${options.size}` : null,
      selectedAttributes: options.size ? { size: options.size } : (options.chosen ?? null),
    });
    if (options.assignedUnitId) {
      await louezDb.db.insert(louezDb.reservationItemUnits).values({
        id: nextId("asg"),
        reservationItemId: itemId,
        productUnitId: options.assignedUnitId,
        identifierSnapshot: "W",
      });
    }
    return id;
  }

  type Line = { productId: string; quantity: number; selectedAttributes?: UnitAttributes };

  type CustomLine = { name: string; unitPrice: number; quantity: number };

  const create = (
    items: Line[],
    {
      customLines,
      ...options
    }: {
      allowOverbooking?: boolean;
      sendAsQuote?: boolean;
      tulipInsuranceOptIn?: boolean;
      customLines?: CustomLine[];
    } = {},
  ): Promise<{
    success?: boolean;
    reservationId?: string;
    error?: string;
    shortfalls?: unknown[];
  }> =>
    actions.createManualReservation({
      customerId: CUSTOMER,
      startDate: START,
      endDate: END,
      items,
      customItems: customLines?.map((line) => ({
        ...line,
        description: "",
        deposit: 0,
        pricingMode: "day" as const,
      })),
      sendConfirmationEmail: false,
      ...options,
    });

  /** How many reservations and activity rows the store holds: unchanged by a refusal. */
  async function storeCounts() {
    const reservationRows = await louezDb.db
      .select({ id: louezDb.reservations.id })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.storeId, STORE));
    const activityRows = await louezDb.db
      .select({ id: louezDb.reservationActivity.id })
      .from(louezDb.reservationActivity);
    const itemRows = await louezDb.db
      .select({ id: louezDb.reservationItems.id })
      .from(louezDb.reservationItems);
    return {
      reservations: reservationRows.length,
      items: itemRows.length,
      activity: activityRows.length,
    };
  }

  /** What a creation wrote: the reservation, its lines in order, its "created" row. */
  async function writtenBy(result: { reservationId?: string; error?: string }) {
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(result.reservationId);
    const reservationId = result.reservationId;
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, reservationId));
    const i = louezDb.reservationItems;
    const lines = await louezDb.db
      .select({
        productId: i.productId,
        quantity: i.quantity,
        combinationKey: i.combinationKey,
        selectedAttributes: i.selectedAttributes,
        consumedQuantity: i.consumedQuantity,
        productSnapshot: i.productSnapshot,
      })
      .from(i)
      .where(eq(i.reservationId, reservationId));
    const a = louezDb.reservationActivity;
    const created = await louezDb.db
      .select({ metadata: a.metadata })
      .from(a)
      .where(and(eq(a.reservationId, reservationId), eq(a.activityType, "created")));
    assert.equal(created.length, 1, "one created row");
    return { reservationId, status: row?.status, lines, created: created[0]?.metadata ?? {} };
  }

  /** The combination and the values each line of a product stores. */
  const combinationsOf = (written: Awaited<ReturnType<typeof writtenBy>>, productId: string) =>
    written.lines
      .filter((line) => line.productId === productId)
      .map((line) => [line.quantity, line.combinationKey, line.selectedAttributes])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  async function stockOf(productId: string) {
    const [row] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    return row?.quantity;
  }

  /** The ids of the reservations the inbox lists as overbooked. */
  async function overbookedInInbox() {
    const { items } = await inbox.listInbox(
      {
        store: {
          id: STORE,
          slug: "creations",
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
    combinationKey: string | null = null,
  ) => ({ productId, productName, combinationKey, requested, available });

  const refusedWith = (...shortfalls: Array<ReturnType<typeof shortfall>>) => ({
    error: "errors.insufficientCapacity",
    shortfalls,
  });

  describe("a product counted by quantity", () => {
    test("with free stock is written as confirmed, and its verdict says it fits", async () => {
      const bikes = await product("Bike", 2);

      const written = await writtenBy(await create([{ productId: bikes, quantity: 2 }]));

      assert.equal(written.status, "confirmed");
      assert.deepEqual(combinationsOf(written, bikes), [[2, null, null]]);
      assert.equal(written.lines[0]?.productSnapshot.combinationKey, null);
      assert.equal(written.created.source, "manual");
      assert.equal(written.created.status, "confirmed");
      assert.equal(written.created.overbooked, false);
      assert.equal("overbookingShortfalls" in written.created, false);
      assert.ok(!(await overbookedInInbox()).includes(written.reservationId));
    });

    test("short of stock is refused with its shortfall, and nothing is written", async () => {
      const bikes = await product("Bike", 2);
      const before = await storeCounts();

      const result = await create([{ productId: bikes, quantity: 3 }]);

      assert.deepEqual(result, refusedWith(shortfall(bikes, "Bike", 3, 2)));
      assert.deepEqual(await storeCounts(), before);
    });

    test("short of stock with the override is written, traced, and shown in the inbox", async () => {
      const bikes = await product("Bike", 2);

      const written = await writtenBy(
        await create([{ productId: bikes, quantity: 3 }], { allowOverbooking: true }),
      );

      assert.equal(written.status, "confirmed");
      assert.deepEqual(combinationsOf(written, bikes), [[3, null, null]]);
      assert.equal(written.created.overbooked, true);
      assert.deepEqual(written.created.overbookingShortfalls, [shortfall(bikes, "Bike", 3, 2)]);
      assert.ok((await overbookedInInbox()).includes(written.reservationId));
    });

    test("two lines of it share its stock: the second is short of what the first left", async () => {
      const bikes = await product("Bike", 2);

      const result = await create([
        { productId: bikes, quantity: 1 },
        { productId: bikes, quantity: 2 },
      ]);

      assert.deepEqual(result, refusedWith(shortfall(bikes, "Bike", 2, 1)));
    });

    test("every short product is listed, in the order of the lines", async () => {
      const bikes = await product("Bike", 1);
      const helmets = await product("Helmet", 5);
      const locks = await product("Lock", 0);

      const result = await create([
        { productId: bikes, quantity: 2 },
        { productId: helmets, quantity: 5 },
        { productId: locks, quantity: 1 },
      ]);

      assert.deepEqual(
        result,
        refusedWith(shortfall(bikes, "Bike", 2, 1), shortfall(locks, "Lock", 1, 0)),
      );
    });

    test("a quote is checked like a booking, and written over the stock with the override", async () => {
      const bikes = await product("Bike", 1);
      const quote = [{ productId: bikes, quantity: 2 }];

      assert.deepEqual(
        await create(quote, { sendAsQuote: true }),
        refusedWith(shortfall(bikes, "Bike", 2, 1)),
      );

      const written = await writtenBy(
        await create(quote, { sendAsQuote: true, allowOverbooking: true }),
      );
      assert.equal(written.status, "quote");
      assert.equal(written.created.overbooked, true);
    });

    test("a product of another store is not found", async () => {
      const foreign = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: foreign,
        storeId: "store_elsewhere",
        name: "Bike",
        price: "10.00",
        pricingMode: "day",
        quantity: 5,
      });

      await assert.rejects(
        create([{ productId: foreign, quantity: 1 }]),
        /errors\.productNotFound/,
      );
    });
  });

  describe("a product with tracked units and no size", () => {
    test("is counted on its units, and its line stores the default combination", async () => {
      const kayaks = await trackedProduct([{}, {}], []);

      const written = await writtenBy(await create([{ productId: kayaks.id, quantity: 2 }]));

      assert.deepEqual(combinationsOf(written, kayaks.id), [[2, "__default", null]]);
      assert.equal(written.lines[0]?.productSnapshot.combinationKey, "__default");
    });

    test("short of units is refused with a shortfall on the product", async () => {
      const kayaks = await trackedProduct([{}, {}], []);

      assert.deepEqual(
        await create([{ productId: kayaks.id, quantity: 3 }]),
        refusedWith(shortfall(kayaks.id, "Wetsuit", 3, 2)),
      );
    });
  });

  describe("a product sold by size", () => {
    test("a line that chose a size stores that combination", async () => {
      const wetsuits = await sized("S", "S", "L");

      const written = await writtenBy(
        await create([{ productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "L" } }]),
      );

      assert.deepEqual(combinationsOf(written, wetsuits.id), [[1, "size:L", { size: "L" }]]);
      assert.deepEqual(
        [
          written.lines[0]?.productSnapshot.combinationKey,
          written.lines[0]?.productSnapshot.selectedAttributes,
        ],
        ["size:L", { size: "L" }],
      );
    });

    test("a size that is short is refused; written with the override, the line keeps its size", async () => {
      const wetsuits = await sized("S", "S", "L");
      const lines = [{ productId: wetsuits.id, quantity: 2, selectedAttributes: { size: "L" } }];

      assert.deepEqual(
        await create(lines),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 2, 1, "size:L")),
      );

      const written = await writtenBy(await create(lines, { allowOverbooking: true }));
      assert.deepEqual(combinationsOf(written, wetsuits.id), [[2, "size:L", { size: "L" }]]);
      assert.deepEqual(written.created.overbookingShortfalls, [
        shortfall(wetsuits.id, "Wetsuit", 2, 1, "size:L"),
      ]);
    });

    test("a size no unit carries is short of everything, and kept on the line with the override", async () => {
      const wetsuits = await sized("S", "L");
      const lines = [{ productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "XL" } }];

      assert.deepEqual(
        await create(lines),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 1, 0, "size:XL")),
      );

      const written = await writtenBy(await create(lines, { allowOverbooking: true }));
      assert.deepEqual(combinationsOf(written, wetsuits.id), [[1, "size:XL", { size: "XL" }]]);
    });

    test("a line with no size stores no combination", async () => {
      const wetsuits = await sized("S", "S", "L");

      const written = await writtenBy(await create([{ productId: wetsuits.id, quantity: 2 }]));

      assert.deepEqual(combinationsOf(written, wetsuits.id), [[2, null, null]]);
      assert.deepEqual(
        [
          written.lines[0]?.productSnapshot.combinationKey,
          written.lines[0]?.productSnapshot.selectedAttributes,
        ],
        [null, null],
      );
    });

    test("a line with no size is served by units of every size", async () => {
      // Two S and one L cover three units of any size.
      const wetsuits = await sized("S", "S", "L");

      const written = await writtenBy(await create([{ productId: wetsuits.id, quantity: 3 }]));

      assert.deepEqual(combinationsOf(written, wetsuits.id), [[3, null, null]]);
      assert.equal(written.created.overbooked, false);
    });

    test("a line with no size, past every unit, is short on the product", async () => {
      const wetsuits = await sized("S", "S", "L");
      const lines = [{ productId: wetsuits.id, quantity: 4 }];

      assert.deepEqual(await create(lines), refusedWith(shortfall(wetsuits.id, "Wetsuit", 4, 3)));

      const written = await writtenBy(await create(lines, { allowOverbooking: true }));
      assert.deepEqual(combinationsOf(written, wetsuits.id), [[4, null, null]]);
    });

    test("a partial choice stores what it chose, and is served by every unit that matches", async () => {
      // Size and colour: the line chooses the size alone.
      const wetsuits = await trackedProduct(
        [
          { size: "M", color: "red" },
          { size: "M", color: "blue" },
          { size: "L", color: "red" },
        ],
        ["size", "color"],
      );
      const ofSize = (size: string, quantity: number) => [
        { productId: wetsuits.id, quantity, selectedAttributes: { size } },
      ];

      // No single combination holds two M: the red one and the blue one serve the line.
      const written = await writtenBy(await create(ofSize("M", 2)));
      assert.deepEqual(combinationsOf(written, wetsuits.id), [[2, null, { size: "M" }]]);

      // Only units of the size asked count: one L, whatever the product has.
      assert.deepEqual(
        await create(ofSize("L", 2)),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 2, 1)),
      );
    });

    test("two lines of it: the one with no size leaves the other the size it chose", async () => {
      // One L and one M. The line with no size comes first, and takes the M.
      const wetsuits = await sized("L", "M");

      const written = await writtenBy(
        await create([
          { productId: wetsuits.id, quantity: 1 },
          { productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "L" } },
        ]),
      );

      assert.deepEqual(combinationsOf(written, wetsuits.id), [
        [1, "size:L", { size: "L" }],
        [1, null, null],
      ]);
    });

    test("two lines of one size are short of what the first took", async () => {
      const wetsuits = await sized("L", "M");
      const large = { productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "L" } };

      assert.deepEqual(
        await create([large, large]),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 1, 0, "size:L")),
      );
    });

    test("a unit held by another booking's line of no size is not promised again", async () => {
      // Two M and one L. Another booking's line of no size holds one M.
      const wetsuits = await sized("M", "M", "L");
      await booked(wetsuits.id, 1, { assignedUnitId: wetsuits.unitIds[0] });

      assert.deepEqual(
        await create([{ productId: wetsuits.id, quantity: 2, selectedAttributes: { size: "M" } }]),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 2, 1, "size:M")),
      );
    });

    test("another booking's line of no size counts on the product, whatever the sizes asked", async () => {
      // One M and one L, and a unit of any size already promised: one is left.
      const wetsuits = await sized("M", "L");
      await booked(wetsuits.id, 1);

      assert.deepEqual(
        await create([
          { productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "M" } },
          { productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "L" } },
        ]),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 1, 0, "size:L")),
      );
    });
  });

  describe("a product sold by size and colour, booked one after the other", () => {
    /** One red M, one blue M, one red L. */
    const wetsuitsBySizeAndColour = () =>
      trackedProduct(
        [
          { size: "M", color: "red" },
          { size: "M", color: "blue" },
          { size: "L", color: "red" },
        ],
        ["size", "color"],
      );
    const mediumRed = (productId: string) => [
      { productId, quantity: 1, selectedAttributes: { size: "M", color: "red" } },
    ];

    test("two M of any colour, then a red M: the red M is promised already", async () => {
      const wetsuits = await wetsuitsBySizeAndColour();
      const first = await writtenBy(
        await create([{ productId: wetsuits.id, quantity: 2, selectedAttributes: { size: "M" } }]),
      );
      assert.deepEqual(combinationsOf(first, wetsuits.id), [[2, null, { size: "M" }]]);
      assert.equal(first.created.overbooked, false);
      const before = await storeCounts();

      // Three M would be out for the two the store has.
      assert.deepEqual(
        await create(mediumRed(wetsuits.id)),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 1, 0, "size:M|color:red")),
      );
      assert.deepEqual(await storeCounts(), before);

      // The L is not one of them.
      const large = await writtenBy(
        await create([
          { productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "L", color: "red" } },
        ]),
      );
      assert.equal(large.created.overbooked, false);
    });

    test("the red M booked over them is traced with its shortfall", async () => {
      const wetsuits = await wetsuitsBySizeAndColour();
      await booked(wetsuits.id, 2, { chosen: { size: "M" } });

      const written = await writtenBy(
        await create(mediumRed(wetsuits.id), { allowOverbooking: true }),
      );

      assert.deepEqual(written.created.overbookingShortfalls, [
        shortfall(wetsuits.id, "Wetsuit", 1, 0, "size:M|color:red"),
      ]);
      assert.ok((await overbookedInInbox()).includes(written.reservationId));
    });

    test("a request that chose a colour alone holds it too, unless requests do not block", async () => {
      const wetsuits = await wetsuitsBySizeAndColour();
      await booked(wetsuits.id, 2, { status: "pending", chosen: { color: "red" } });
      const reds = [{ productId: wetsuits.id, quantity: 1, selectedAttributes: { color: "red" } }];

      assert.deepEqual(await create(reds), refusedWith(shortfall(wetsuits.id, "Wetsuit", 1, 0)));
      await writtenBy(await withSettings({ pendingBlocksAvailability: false }, () => create(reds)));
    });

    test("a marketplace checkout finds the red M promised, and the red L free", async () => {
      const wetsuits = await wetsuitsBySizeAndColour();
      await writtenBy(
        await create([{ productId: wetsuits.id, quantity: 2, selectedAttributes: { size: "M" } }]),
      );
      /** A marketplace booking of one unit, through the checkout's own stock check. */
      const marketplaceBooks = async (selectedAttributes: UnitAttributes) => {
        const holdId = nextId("hold").padEnd(21, "0");
        await louezDb.db.insert(louezDb.marketplaceBookingAttempts).values({
          id: nextId("att"),
          bookingAttemptId: `attempt-${holdId}`,
          storeId: STORE,
          quoteTokenHash: "0".repeat(64),
          holdId,
          reservationId: holdId,
          status: "creating_hold",
          expiresAt: new Date(Date.now() + 30 * MINUTE),
        });
        const result = await checkout.createReservation({
          source: "marketplace",
          marketplaceSecret: MARKETPLACE_SECRET,
          reservationId: holdId,
          storeId: STORE,
          customer: { email: "walker@example.test", firstName: "Walk", lastName: "In" },
          items: [
            {
              lineId: "0",
              productId: wetsuits.id,
              quantity: 1,
              startDate: START.toISOString(),
              endDate: END.toISOString(),
              unitPrice: 10,
              depositPerUnit: 0,
              selectedAttributes,
            },
          ],
          subtotalAmount: 20,
          depositAmount: 0,
          totalAmount: 20,
        });
        return { holdId, outcome: result.ok ? "written" : result.error };
      };

      assert.equal(
        (await marketplaceBooks({ size: "M", color: "red" })).outcome,
        "errors.productNoLongerAvailable",
      );
      // A cart line that chose the size alone finds no M either.
      assert.equal(
        (await marketplaceBooks({ size: "M" })).outcome,
        "errors.productNoLongerAvailable",
      );

      const large = await marketplaceBooks({ color: "red" });
      assert.equal(large.outcome, "written");
      const lines = await louezDb.db
        .select({ combinationKey: louezDb.reservationItems.combinationKey })
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, large.holdId));
      // The red M comes first in the order of the combinations: it is passed over.
      assert.deepEqual(lines, [{ combinationKey: "size:L|color:red" }]);
    });
  });

  describe("a unit given to a line of no size or colour", () => {
    /** A red M and a blue L; another booking chose red, and left the size open. */
    async function assigning() {
      const wetsuits = await trackedProduct(
        [
          { size: "M", color: "red" },
          { size: "L", color: "blue" },
        ],
        ["size", "color"],
      );
      await booked(wetsuits.id, 1, { chosen: { color: "red" } });
      const reservationId = await booked(wetsuits.id, 1);
      const [line] = await louezDb.db
        .select({ id: louezDb.reservationItems.id })
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, reservationId));
      assert.ok(line);
      const [redM = "", blueL = ""] = wetsuits.unitIds;
      return { itemId: line.id, redM, blueL };
    }

    test("the unit the other booking's choice needs is refused for lack of stock", async () => {
      const { itemId, redM } = await assigning();

      // The unit is valid: what is short is the stock, which owes the red M.
      assert.deepEqual(await actions.assignUnitsToReservationItem(itemId, [redM]), {
        error: "errors.insufficientCapacity",
        failedUnitIds: [redM],
      });
    });

    test("a unit the other booking does not need is assigned", async () => {
      const { itemId, blueL } = await assigning();

      const result = await actions.assignUnitsToReservationItem(itemId, [blueL]);

      assert.equal(result.error, undefined);
    });
  });

  describe("lines that are not a product", () => {
    /** The lines a creation wrote, in the order it wrote them. */
    async function linesOf(reservationId: string) {
      const i = louezDb.reservationItems;
      const rows = await louezDb.db
        .select({
          productId: i.productId,
          isCustomItem: i.isCustomItem,
          quantity: i.quantity,
          totalPrice: i.totalPrice,
          combinationKey: i.combinationKey,
          productSnapshot: i.productSnapshot,
        })
        .from(i)
        .where(eq(i.reservationId, reservationId));
      const [reservationRow] = await louezDb.db
        .select({
          subtotalAmount: louezDb.reservations.subtotalAmount,
          totalAmount: louezDb.reservations.totalAmount,
          tulipInsuranceAmount: louezDb.reservations.tulipInsuranceAmount,
        })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      return {
        reservationRow,
        lines: rows
          .map((row) => ({
            name: row.productSnapshot.name,
            productId: row.productId,
            isCustomItem: row.isCustomItem,
            quantity: row.quantity,
            totalPrice: row.totalPrice,
            combinationKey: row.combinationKey,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "en")),
      };
    }
    const delivery = { name: "Delivery", unitPrice: 5, quantity: 50 };
    const custom = (name: string, quantity: number, totalPrice: string) => ({
      name,
      productId: null,
      isCustomItem: true,
      quantity,
      totalPrice,
      combinationKey: null,
    });

    test("a custom line is written whatever its quantity, and takes no stock", async () => {
      const bikes = await product("Bike", 1);

      const written = await writtenBy(
        await create([{ productId: bikes, quantity: 1 }], { customLines: [delivery] }),
      );

      assert.equal(written.created.overbooked, false);
      const { lines, reservationRow } = await linesOf(written.reservationId);
      assert.deepEqual(lines, [
        { ...custom("Bike", 1, "20.00"), productId: bikes, isCustomItem: false },
        custom("Delivery", 50, "500.00"),
      ]);
      assert.equal(reservationRow?.subtotalAmount, "520.00");
    });

    test("a custom line is not listed among the shortfalls of a booking that is short", async () => {
      const bikes = await product("Bike", 1);
      const before = await storeCounts();

      assert.deepEqual(
        await create([{ productId: bikes, quantity: 2 }], { customLines: [delivery] }),
        refusedWith(shortfall(bikes, "Bike", 2, 1)),
      );
      assert.deepEqual(await storeCounts(), before);

      const written = await writtenBy(
        await create([{ productId: bikes, quantity: 2 }], {
          customLines: [delivery],
          allowOverbooking: true,
        }),
      );
      assert.deepEqual(written.created.overbookingShortfalls, [shortfall(bikes, "Bike", 2, 1)]);
    });

    test("the insurance is written as a line of its own, and takes no stock", async () => {
      const bikes = await product("Bike", 1);
      Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
      try {
        const written = await writtenBy(
          await create([{ productId: bikes, quantity: 1 }], {
            customLines: [delivery],
            tulipInsuranceOptIn: true,
          }),
        );

        assert.equal(written.created.overbooked, false);
        assert.equal(written.created.tulipInsuranceAmount, 12.5);
        const { lines, reservationRow } = await linesOf(written.reservationId);
        assert.deepEqual(lines, [
          { ...custom("Bike", 1, "20.00"), productId: bikes, isCustomItem: false },
          custom("Delivery", 50, "500.00"),
          custom("Garantie casse/vol", 1, "12.50"),
        ]);
        assert.deepEqual(
          [reservationRow?.subtotalAmount, reservationRow?.tulipInsuranceAmount],
          ["532.50", "12.50"],
        );

        // Short of bikes, with the insurance asked: the bike alone is listed.
        assert.deepEqual(
          await create([{ productId: bikes, quantity: 1 }], { tulipInsuranceOptIn: true }),
          refusedWith(shortfall(bikes, "Bike", 1, 0)),
        );
      } finally {
        Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
      }
    });
  });

  describe("a creation, then an edit", () => {
    /** The verdicts a reservation's history holds, oldest first: its creation, then its edits. */
    async function verdictsOf(reservationId: string) {
      const a = louezDb.reservationActivity;
      const rows = await louezDb.db
        .select({ type: a.activityType, metadata: a.metadata, createdAt: a.createdAt })
        .from(a)
        .where(eq(a.reservationId, reservationId))
        .orderBy(a.createdAt);
      return rows.flatMap((row) =>
        row.metadata && "overbooked" in row.metadata
          ? [[row.type, row.metadata.overbooked, row.metadata.overbookingShortfalls ?? null]]
          : [],
      );
    }

    /** The reservation's one line, as the edit form submits it with another quantity. */
    async function withQuantity(reservationId: string, quantity: number) {
      const [line] = await louezDb.db
        .select({ id: louezDb.reservationItems.id, productId: louezDb.reservationItems.productId })
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, reservationId));
      assert.ok(line?.productId);
      return [
        {
          id: line.id,
          productId: line.productId,
          quantity,
          unitPrice: 10,
          depositPerUnit: 0,
          productSnapshot: { name: "Bike" },
        },
      ];
    }

    test("that fits, then is forced over the stock: the inbox shows it after the edit", async () => {
      const bikes = await product("Bike", 2);
      const { reservationId } = await writtenBy(await create([{ productId: bikes, quantity: 2 }]));
      assert.ok(!(await overbookedInInbox()).includes(reservationId));

      const items = await withQuantity(reservationId, 3);
      assert.deepEqual(await actions.updateReservation(reservationId, { items }), {
        error: "errors.insufficientCapacity",
        shortfalls: [shortfall(bikes, "Bike", 3, 2)],
      });
      assert.ok(
        !(await overbookedInInbox()).includes(reservationId),
        "a refused edit shows nothing",
      );

      const forced = await actions.updateReservation(reservationId, {
        items,
        allowOverbooking: true,
      });
      assert.equal(forced.error, undefined);
      assert.deepEqual(await verdictsOf(reservationId), [
        ["created", false, null],
        ["modified", true, [shortfall(bikes, "Bike", 3, 2)]],
      ]);
      assert.ok((await overbookedInInbox()).includes(reservationId));
    });

    test("that is forced over the stock, then fits: the inbox drops it after the edit", async () => {
      const bikes = await product("Bike", 2);
      const { reservationId } = await writtenBy(
        await create([{ productId: bikes, quantity: 3 }], { allowOverbooking: true }),
      );
      assert.ok((await overbookedInInbox()).includes(reservationId));

      // Back within the stock: no override is asked.
      const fitted = await actions.updateReservation(reservationId, {
        items: await withQuantity(reservationId, 2),
      });

      assert.equal(fitted.error, undefined);
      assert.deepEqual(await verdictsOf(reservationId), [
        ["created", true, [shortfall(bikes, "Bike", 3, 2)]],
        ["modified", false, null],
      ]);
      assert.ok(!(await overbookedInInbox()).includes(reservationId));
    });
  });

  describe("a consumable product", () => {
    test("with enough on hand is written, and a confirmed booking takes it", async () => {
      const gas = await product("Gas", 5, "consumable");

      const written = await writtenBy(await create([{ productId: gas, quantity: 2 }]));

      assert.equal(written.lines[0]?.consumedQuantity, 2);
      assert.equal(await stockOf(gas), 3);
    });

    test("a quote takes nothing", async () => {
      const gas = await product("Gas", 5, "consumable");

      const written = await writtenBy(
        await create([{ productId: gas, quantity: 2 }], { sendAsQuote: true }),
      );

      assert.equal(written.lines[0]?.consumedQuantity, 0);
      assert.equal(await stockOf(gas), 5);
    });

    test("short of what is on hand is refused with its shortfall", async () => {
      const gas = await product("Gas", 5, "consumable");
      const before = await storeCounts();

      assert.deepEqual(
        await create([{ productId: gas, quantity: 6 }]),
        refusedWith(shortfall(gas, "Gas", 6, 5)),
      );
      assert.deepEqual(await storeCounts(), before);
      assert.equal(await stockOf(gas), 5);
    });

    test("no override takes it below zero: the booking is refused, and nothing is written", async () => {
      const gas = await product("Gas", 5, "consumable");
      const before = await storeCounts();

      assert.deepEqual(
        await create([{ productId: gas, quantity: 6 }], { allowOverbooking: true }),
        {
          error: "errors.consumableInsufficientStock",
          shortfalls: [],
        },
      );
      assert.deepEqual(await storeCounts(), before);
      assert.equal(await stockOf(gas), 5);
    });

    test("what a request holds and has not taken yet is not free; the override books over it", async () => {
      // Five on hand, three of them promised to a request that took nothing yet.
      const gas = await product("Gas", 5, "consumable");
      await booked(gas, 3, { status: "pending" });
      const lines = [{ productId: gas, quantity: 4 }];

      assert.deepEqual(await create(lines), refusedWith(shortfall(gas, "Gas", 4, 2)));

      const written = await writtenBy(await create(lines, { allowOverbooking: true }));
      assert.equal(written.created.overbooked, true);
      assert.deepEqual(written.created.overbookingShortfalls, [shortfall(gas, "Gas", 4, 2)]);
      assert.equal(await stockOf(gas), 1);
    });

    test("a quote past what is on hand is written with the override, and takes nothing", async () => {
      const gas = await product("Gas", 5, "consumable");

      const written = await writtenBy(
        await create([{ productId: gas, quantity: 6 }], {
          sendAsQuote: true,
          allowOverbooking: true,
        }),
      );

      assert.equal(written.status, "quote");
      assert.equal(written.created.overbooked, true);
      assert.equal(await stockOf(gas), 5);
    });

    test("has no dates: a booking on other days holds it all the same", async () => {
      const gas = await product("Gas", 5, "consumable");
      await booked(gas, 3, {
        status: "pending",
        start: new Date(START.getTime() + 30 * DAY),
        end: new Date(END.getTime() + 30 * DAY),
      });

      assert.deepEqual(
        await create([{ productId: gas, quantity: 4 }]),
        refusedWith(shortfall(gas, "Gas", 4, 2)),
      );
    });
  });

  test("an untracked product has no limit", async () => {
    const maps = await product("Map", 1, "untracked");

    const written = await writtenBy(await create([{ productId: maps, quantity: 50 }]));

    assert.deepEqual(combinationsOf(written, maps), [[50, null, null]]);
    assert.equal(written.created.overbooked, false);
  });

  describe("the turnover buffer", () => {
    // A buffer of a day, and bookings an hour or two days away from the
    // window: the test reads the same in every time zone.
    const BUFFER = { turnoverBufferMinutes: 24 * 60 };
    const HOUR = 60 * MINUTE;

    test("a booking that ends at the start leaves its stock free without a buffer", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1, { start: new Date(START.getTime() - DAY), end: START });

      await writtenBy(await create([{ productId: bikes, quantity: 1 }]));
    });

    test("a booking that ends within the buffer before the start holds its stock", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1, {
        start: new Date(START.getTime() - 3 * DAY),
        end: new Date(START.getTime() - HOUR),
      });

      const result = await withSettings(BUFFER, () => create([{ productId: bikes, quantity: 1 }]));

      assert.deepEqual(result, refusedWith(shortfall(bikes, "Bike", 1, 0)));
    });

    test("a booking that starts within the buffer after the end holds its stock", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1, {
        start: new Date(END.getTime() + HOUR),
        end: new Date(END.getTime() + 3 * DAY),
      });

      const result = await withSettings(BUFFER, () => create([{ productId: bikes, quantity: 1 }]));

      assert.deepEqual(result, refusedWith(shortfall(bikes, "Bike", 1, 0)));
    });

    test("a booking that ended before the buffer leaves its stock free", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1, {
        start: new Date(START.getTime() - 4 * DAY),
        end: new Date(START.getTime() - 2 * DAY),
      });

      const result = await withSettings(BUFFER, () => create([{ productId: bikes, quantity: 1 }]));

      await writtenBy(result);
    });
  });

  describe("a competing booking", () => {
    for (const status of ["pending", "confirmed", "ongoing"] as const) {
      test(`${status} holds its stock`, async () => {
        const bikes = await product("Bike", 1);
        await booked(bikes, 1, { status });

        assert.deepEqual(
          await create([{ productId: bikes, quantity: 1 }]),
          refusedWith(shortfall(bikes, "Bike", 1, 0)),
        );
      });
    }

    for (const status of ["quote", "completed", "cancelled", "rejected", "declined"] as const) {
      test(`${status} holds none`, async () => {
        const bikes = await product("Bike", 1);
        await booked(bikes, 1, { status });

        await writtenBy(await create([{ productId: bikes, quantity: 1 }]));
      });
    }

    test("a request holds none when the store lets requests not block", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1, { status: "pending" });

      const result = await withSettings({ pendingBlocksAvailability: false }, () =>
        create([{ productId: bikes, quantity: 1 }]),
      );

      await writtenBy(result);
    });

    test("a request holds no consumable either when requests do not block", async () => {
      const gas = await product("Gas", 5, "consumable");
      await booked(gas, 3, { status: "pending" });

      const result = await withSettings({ pendingBlocksAvailability: false }, () =>
        create([{ productId: gas, quantity: 4 }]),
      );

      await writtenBy(result);
    });
  });

  describe("a unit that cannot be rented", () => {
    test("in downtime over the dates is not counted", async () => {
      const wetsuits = await sized("M", "M");
      await louezDb.db.insert(louezDb.productUnitDowntimes).values({
        id: nextId("dwn"),
        productUnitId: wetsuits.unitIds[0] ?? "",
        storeId: STORE,
        reason: "maintenance",
        startsAt: new Date(START.getTime() + DAY),
        endsAt: null,
      });

      assert.deepEqual(
        await create([{ productId: wetsuits.id, quantity: 2 }]),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 2, 1)),
      );
    });

    test("in downtime that ends before the dates is counted", async () => {
      const wetsuits = await sized("M", "M");
      await louezDb.db.insert(louezDb.productUnitDowntimes).values({
        id: nextId("dwn"),
        productUnitId: wetsuits.unitIds[0] ?? "",
        storeId: STORE,
        reason: "maintenance",
        startsAt: new Date(START.getTime() - 5 * DAY),
        endsAt: new Date(START.getTime() - DAY),
      });

      await writtenBy(await create([{ productId: wetsuits.id, quantity: 2 }]));
    });

    test("retired is not counted", async () => {
      const wetsuits = await sized("M", "M");
      await louezDb.db
        .update(louezDb.productUnits)
        .set({ lifecycleStatus: "retired" })
        .where(eq(louezDb.productUnits.id, wetsuits.unitIds[0] ?? ""));

      assert.deepEqual(
        await create([{ productId: wetsuits.id, quantity: 2, selectedAttributes: { size: "M" } }]),
        refusedWith(shortfall(wetsuits.id, "Wetsuit", 2, 1, "size:M")),
      );
    });
  });

  describe("a marketplace hold", () => {
    async function hold(productId: string, expiresAt: Date, quantity = 1) {
      const reservationId = await booked(productId, quantity, {
        status: "pending",
        source: "marketplace",
      });
      await louezDb.db.insert(louezDb.marketplaceBookingAttempts).values({
        id: nextId("att"),
        bookingAttemptId: `attempt-${reservationId}`,
        storeId: STORE,
        quoteTokenHash: "0".repeat(64),
        holdId: reservationId,
        reservationId,
        status: "holding",
        expiresAt,
      });
    }

    test("that is live holds its stock", async () => {
      const bikes = await product("Bike", 1);
      await hold(bikes, new Date(Date.now() + 30 * MINUTE));

      assert.deepEqual(
        await create([{ productId: bikes, quantity: 1 }]),
        refusedWith(shortfall(bikes, "Bike", 1, 0)),
      );
    });

    test("that expired holds none", async () => {
      const bikes = await product("Bike", 1);
      await hold(bikes, new Date(Date.now() - 30 * MINUTE));

      const written = await writtenBy(await create([{ productId: bikes, quantity: 1 }]));

      assert.equal(written.created.overbooked, false);
    });

    test("that is live holds the consumable it has not taken yet", async () => {
      const gas = await product("Gas", 5, "consumable");
      await hold(gas, new Date(Date.now() + 30 * MINUTE), 3);

      assert.deepEqual(
        await create([{ productId: gas, quantity: 4 }]),
        refusedWith(shortfall(gas, "Gas", 4, 2)),
      );
    });

    test("that expired holds no consumable either", async () => {
      const gas = await product("Gas", 5, "consumable");
      await hold(gas, new Date(Date.now() - 30 * MINUTE), 3);

      const written = await writtenBy(await create([{ productId: gas, quantity: 4 }]));

      assert.equal(written.created.overbooked, false);
      assert.equal(await stockOf(gas), 1);
    });
  });

  describe("an extension checkout on another reservation", () => {
    /** A booking that ends a day before the start, asking to stay a day into the window. */
    async function extending(productId: string, expiresMs: number) {
      const reservationId = await booked(productId, 1, {
        start: new Date(START.getTime() - 3 * DAY),
        end: new Date(START.getTime() - DAY),
      });
      await louezDb.db.insert(louezDb.reservationActivity).values({
        id: nextId("act"),
        reservationId,
        activityType: "modified",
        metadata: {
          kind: "rental_extension",
          status: "checkout",
          requestedEndMs: START.getTime() + DAY,
          expiresMs,
        },
      });
    }

    test("that is live holds the stock to the end it asks for", async () => {
      const bikes = await product("Bike", 1);
      await extending(bikes, Date.now() + 30 * MINUTE);

      assert.deepEqual(
        await create([{ productId: bikes, quantity: 1 }]),
        refusedWith(shortfall(bikes, "Bike", 1, 0)),
      );
    });

    test("that expired holds nothing past the booked end", async () => {
      const bikes = await product("Bike", 1);
      await extending(bikes, Date.now() - 30 * MINUTE);

      await writtenBy(await create([{ productId: bikes, quantity: 1 }]));
    });
  });

  describe("the trace of an overbooking", () => {
    test("is written with the booking: when it cannot be, neither is", async () => {
      const bikes = await product("Bike", 1);
      const before = await storeCounts();
      const connection = await database.connect();
      try {
        await connection.query(
          `CREATE TRIGGER refuse_created_activity BEFORE INSERT ON reservation_activity
           FOR EACH ROW
           BEGIN
             IF NEW.activity_type = 'created' THEN
               SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'activity refused';
             END IF;
           END`,
        );
        await assert.rejects(
          create([{ productId: bikes, quantity: 2 }], { allowOverbooking: true }),
        );
      } finally {
        await connection.query("DROP TRIGGER IF EXISTS refuse_created_activity");
        await connection.end();
      }

      assert.deepEqual(await storeCounts(), before);
    });
  });

  describe("what the stock decision reads", () => {
    test("the store's rules come with the stock, not from the session", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1, { status: "pending" });
      // The session still holds settings under which a request does not block.
      useSession({ ...SETTINGS, pendingBlocksAvailability: false });
      try {
        assert.deepEqual(
          await create([{ productId: bikes, quantity: 1 }]),
          refusedWith(shortfall(bikes, "Bike", 1, 0)),
        );
      } finally {
        await useStore();
      }
    });

    test("a product that became sold by size while the creation waited is read under its lock", async () => {
      const wetsuits = await trackedProduct([{}, {}], []);
      const [first, second] = wetsuits.unitIds;

      const [result] = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [wetsuits.id]);
          await holder.query("UPDATE products SET booking_attribute_axes = ? WHERE id = ?", [
            JSON.stringify([{ key: "size", label: "size", position: 0 }]),
            wetsuits.id,
          ]);
          for (const [unitId, size] of [
            [first, "M"],
            [second, "L"],
          ]) {
            await holder.query(
              "UPDATE product_units SET attributes = ?, combination_key = ? WHERE id = ?",
              [JSON.stringify({ size }), `size:${size}`, unitId],
            );
          }
        },
        [
          () =>
            create([{ productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "L" } }]),
        ],
      );

      assert.ok(result);
      const written = await writtenBy(result);
      assert.deepEqual(combinationsOf(written, wetsuits.id), [[1, "size:L", { size: "L" }]]);
    });
  });

  describe("two creations at once", () => {
    test("on the last unit: one is written, the other is refused with its shortfall", async () => {
      const bikes = await product("Bike", 1);
      const one = () => create([{ productId: bikes, quantity: 1 }]);

      const results = await raceOnLockedRow(database, { table: "products", id: bikes }, [one, one]);

      assert.deepEqual(results.map((result) => result.error ?? "written").sort(), [
        "errors.insufficientCapacity",
        "written",
      ]);
      const refused = results.find((result) => result.error);
      assert.deepEqual(refused?.shortfalls, [shortfall(bikes, "Bike", 1, 0)]);
    });

    test("on the last unit of a size: one is written, the other is refused", async () => {
      const wetsuits = await sized("M", "L");
      const medium = () =>
        create([{ productId: wetsuits.id, quantity: 1, selectedAttributes: { size: "M" } }]);

      const results = await raceOnLockedRow(database, { table: "products", id: wetsuits.id }, [
        medium,
        medium,
      ]);

      assert.deepEqual(results.map((result) => result.error ?? "written").sort(), [
        "errors.insufficientCapacity",
        "written",
      ]);
    });
  });

  test("a creation racing a marketplace checkout for the last unit: only one is written", async () => {
    const bikes = await product("Bike", 1);
    // The marketplace records its attempt, then asks the checkout for the hold.
    const holdId = nextId("hold").padEnd(21, "0");
    await louezDb.db.insert(louezDb.marketplaceBookingAttempts).values({
      id: nextId("att"),
      bookingAttemptId: `attempt-${holdId}`,
      storeId: STORE,
      quoteTokenHash: "0".repeat(64),
      holdId,
      reservationId: holdId,
      status: "creating_hold",
      expiresAt: new Date(Date.now() + 30 * MINUTE),
    });

    const outcomes = await raceOnLockedRow(database, { table: "products", id: bikes }, [
      async () => (await create([{ productId: bikes, quantity: 1 }])).error ?? "written",
      async () => {
        const result = await checkout.createReservation({
          source: "marketplace",
          marketplaceSecret: MARKETPLACE_SECRET,
          reservationId: holdId,
          storeId: STORE,
          customer: { email: "walker@example.test", firstName: "Walk", lastName: "In" },
          items: [
            {
              lineId: "0",
              productId: bikes,
              quantity: 1,
              startDate: START.toISOString(),
              endDate: END.toISOString(),
              unitPrice: 10,
              depositPerUnit: 0,
            },
          ],
          subtotalAmount: 20,
          depositAmount: 0,
          totalAmount: 20,
        });
        return result.ok ? "written" : result.error;
      },
    ]);

    assert.equal(
      outcomes.filter((outcome) => outcome === "written").length,
      1,
      `one of the two is written: ${outcomes.join(", ")}`,
    );
    assert.ok(
      outcomes.includes("errors.insufficientCapacity") ||
        outcomes.includes("errors.productNoLongerAvailable"),
      `the other is refused for the stock: ${outcomes.join(", ")}`,
    );
    const holding = await louezDb.db
      .select({ quantity: louezDb.reservationItems.quantity })
      .from(louezDb.reservationItems)
      .where(eq(louezDb.reservationItems.productId, bikes));
    assert.deepEqual(holding, [{ quantity: 1 }], "the bike is booked once");
  });
});

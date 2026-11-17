import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { fromZonedTime } from "date-fns-tz";
import { and, eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";
import type { ProductPromotion, StoreSettings, UnitAttributes } from "@louez/types";
import { buildCombinationKey } from "@louez/utils";

import {
  NOT_RECORDED,
  recordedPromotion,
  recordedTaxDisplayMode,
  recordedTaxExempt,
} from "@louez/api/services/pricing-facts";

import { STORE_KEY } from "./actions-test-stubs";
import type { Product as FormProduct } from "./new/types";
import { creationTotals } from "./new/utils/creation-totals";
import { productLinePricing } from "./new/utils/product-line-pricing";
import { buildSeasonalPricingConfigs } from "@louez/api/services/catalogue-line-pricing";

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
// What the creation writes for the facts test's input: since slice 10, the tax
// engine's totals, the 20 % added to prices given before tax, the insurance
// outside it.
const MANUAL_MONEY = {
  subtotal: "532.50",
  deposit: "0.00",
  total: "636.50",
  subtotalExclTax: "532.50",
  tax: "104.00",
  taxRate: "20.00",
  discount: "0.00",
  deliveryFee: "0.00",
  insurance: "12.50",
};
const MANUAL_LINES = [
  ["Bike", "20.00", "20.00", "20.00", "4.00", "20.00", "20.00"],
  ["Delivery", "5.00", "500.00", "20.00", "100.00", "5.00", "500.00"],
  ["Garantie casse/vol", "12.50", "12.50", null, "0.00", "12.50", "12.50"],
];
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
// The e-mail sender, as the action sees it: the confirmation it is asked to
// send is handed to whoever waits for it under this key; nothing is sent.
const CONFIRMATION_EMAIL_KEY = "__louezCreationTestConfirmationEmail";
INSURER_STUBS["@/lib/email/send"] =
  `export async function sendReservationConfirmationEmail(input) {
    globalThis[${JSON.stringify(CONFIRMATION_EMAIL_KEY)}]?.(input);
    return { success: true };
  }
  export async function sendPaymentRequestEmail() { return { success: true }; }
  export async function sendDepositAuthorizationRequestEmail() { return { success: true }; }
  export async function logEmail() {}\n`;
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
  let extension: typeof import("@/lib/reservations/extension-quote");
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
    extension = await import("@/lib/reservations/extension-quote");
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

  /** A product as the creation page loads it (`getProductsWithTiers`), its seasons as the server reads them. */
  async function formProductOf(productId: string): Promise<FormProduct> {
    const row = await louezDb.db.query.products.findFirst({
      where: eq(louezDb.products.id, productId),
      with: { pricingTiers: true, seasonalPricings: { with: { tiers: true } } },
    });
    assert.ok(row);
    return {
      ...row,
      units: [],
      seasonalPricings:
        buildSeasonalPricingConfigs(
          row.seasonalPricings,
          row.seasonalPricings.flatMap((season) => season.tiers),
        ).get(row.id) ?? [],
    };
  }

  /**
   * The total the creation form shows, and sends, for these lines: each
   * priced by the form (`productLinePricing`) at `now`, totalled by
   * `creationTotals` in the store's settings.
   */
  async function formTotal(
    lines: Array<{ productId: string; quantity: number; priceOverride?: number }>,
    window: { start: Date; end: Date; now: Date },
    settings: StoreSettings,
  ) {
    const productLines = [];
    for (const [index, line] of lines.entries()) {
      const product = await formProductOf(line.productId);
      const pricing = productLinePricing({
        product,
        selectedItem: {
          lineId: String(index),
          productId: line.productId,
          quantity: line.quantity,
          ...(line.priceOverride === undefined
            ? {}
            : { priceOverride: { unitPrice: line.priceOverride } }),
        },
        startDate: window.start,
        endDate: window.end,
        timezone: settings.timezone,
        now: window.now,
      });
      productLines.push({
        subtotal: pricing.lineSubtotal,
        unitPrice: pricing.lineUnitPrice,
        typed: pricing.hasPriceOverride,
        taxSettings: product.taxSettings ?? null,
      });
    }
    return creationTotals({
      productLines,
      customLines: [],
      insuranceAmount: 0,
      deliveryFee: 0,
      discountAmount: 0,
      deposit: 0,
      taxSettings: settings.tax,
      currency: settings.currency,
    }).total;
  }

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

  describe("a store that keeps a turnover buffer", () => {
    const BUFFER = 120;
    const HOUR = 3_600_000;
    /** Back an hour before START: inside a two-hour buffer, clear of it without. */
    const JUST_BEFORE = {
      start: new Date(START.getTime() - 2 * DAY - HOUR),
      end: new Date(START.getTime() - HOUR),
    };
    /** The verdicts of a "created" row, and nothing else. */
    const verdictsOf = (metadata: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(metadata).filter(([key]) =>
          [
            "overbooked",
            "overbookingShortfalls",
            "turnoverBufferOverridden",
            "turnoverBufferShortfalls",
            "turnoverBufferMinutes",
            "credential",
          ].includes(key),
        ),
      );

    test("short only with the buffer: refused as today; forced, recorded past the buffer, not as an overbooking", async () => {
      await withSettings({ turnoverBufferMinutes: BUFFER }, async () => {
        const bikes = await product("Bike", 1);
        await booked(bikes, 1, JUST_BEFORE);
        const before = await storeCounts();

        const refused = await create([{ productId: bikes, quantity: 1 }]);
        assert.deepEqual(refused, refusedWith(shortfall(bikes, "Bike", 1, 0)));
        assert.deepEqual(await storeCounts(), before);

        const written = await writtenBy(
          await create([{ productId: bikes, quantity: 1 }], { allowOverbooking: true }),
        );

        assert.deepEqual(verdictsOf(written.created), {
          overbooked: false,
          turnoverBufferOverridden: true,
          turnoverBufferShortfalls: [shortfall(bikes, "Bike", 1, 0)],
          turnoverBufferMinutes: BUFFER,
          credential: { kind: "session", id: null },
        });
        assert.ok(!(await overbookedInInbox()).includes(written.reservationId));
      });
    });

    test("short on the stock itself: forced, an overbooking counted without the buffer", async () => {
      await withSettings({ turnoverBufferMinutes: BUFFER }, async () => {
        const bikes = await product("Bike", 2);
        await booked(bikes, 1, JUST_BEFORE);
        await booked(bikes, 1);

        // Refused with the buffered figure, as today: none free.
        assert.deepEqual(
          await create([{ productId: bikes, quantity: 2 }]),
          refusedWith(shortfall(bikes, "Bike", 2, 0)),
        );

        const written = await writtenBy(
          await create([{ productId: bikes, quantity: 2 }], { allowOverbooking: true }),
        );

        // Recorded with what the stock leaves without the buffer: one free.
        assert.deepEqual(verdictsOf(written.created), {
          overbooked: true,
          overbookingShortfalls: [shortfall(bikes, "Bike", 2, 1)],
        });
        assert.ok((await overbookedInInbox()).includes(written.reservationId));
      });
    });

    test("with no buffer, a forced creation writes its row as before", async () => {
      const bikes = await product("Bike", 1);
      await booked(bikes, 1);

      const written = await writtenBy(
        await create([{ productId: bikes, quantity: 1 }], { allowOverbooking: true }),
      );

      assert.deepEqual(written.created, {
        source: "manual",
        status: "confirmed",
        tulipInsuranceOptIn: false,
        tulipInsuranceAmount: 0,
        overbooked: true,
        overbookingShortfalls: [shortfall(bikes, "Bike", 1, 0)],
      });
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

  describe("the facts it was priced with (slice 9)", () => {
    test("the tax display mode and each line's exemption are recorded", async () => {
      const bikes = await product("Bike", 1);
      Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
      try {
        const result = await withSettings(
          { tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" } },
          () =>
            create([{ productId: bikes, quantity: 1 }], {
              customLines: [{ name: "Delivery", unitPrice: 5, quantity: 50 }],
              tulipInsuranceOptIn: true,
            }),
        );
        const { reservationId } = await writtenBy(result);
        const r = louezDb.reservations;
        const i = louezDb.reservationItems;
        const [row] = await louezDb.db.select().from(r).where(eq(r.id, reservationId));
        assert.ok(row);
        const items = (
          await louezDb.db.select().from(i).where(eq(i.reservationId, reservationId))
        ).sort((a, b) => a.productSnapshot.name.localeCompare(b.productSnapshot.name, "en"));

        // The money: the tax engine's (slice 10).
        assert.deepEqual(
          {
            subtotal: row.subtotalAmount,
            deposit: row.depositAmount,
            total: row.totalAmount,
            subtotalExclTax: row.subtotalExclTax,
            tax: row.taxAmount,
            taxRate: row.taxRate,
            discount: row.discountAmount,
            deliveryFee: row.deliveryFee,
            insurance: row.tulipInsuranceAmount,
          },
          MANUAL_MONEY,
        );
        assert.deepEqual(
          items.map((item) => [
            item.productSnapshot.name,
            item.unitPrice,
            item.totalPrice,
            item.taxRate,
            item.taxAmount,
            item.priceExclTax,
            item.totalExclTax,
          ]),
          MANUAL_LINES,
        );

        // The facts: the store's mode; the insurance outside the tax; the product
        // line priced with the promotion in force, none here; the custom line records none.
        assert.equal(recordedTaxDisplayMode(row), "exclusive");
        assert.deepEqual(
          items.map((item) => [item.productSnapshot.name, recordedTaxExempt(item)]),
          [
            ["Bike", false],
            ["Delivery", false],
            ["Garantie casse/vol", true],
          ],
        );
        assert.deepEqual(
          items.slice(0, 2).map((item) => [item.productSnapshot.name, recordedPromotion(item)]),
          [
            ["Bike", null],
            ["Delivery", NOT_RECORDED],
          ],
        );
      } finally {
        Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
      }
    });
  });

  describe("a line priced from the catalogue is stored as the checkout stores it", () => {
    // Promotions without dates: in force whatever the day.
    const ALWAYS = { startsOn: null, endsOn: null };
    const BEFORE_TAX = { enabled: true, defaultRate: 20, displayMode: "exclusive" as const };

    interface Case {
      name: string;
      settings: Partial<StoreSettings>;
      product: Partial<typeof louezDb.products.$inferInsert>;
      /** Duration tiers, or the rates of a rate-based product. */
      tiers?: Array<
        { minDuration: number; discountPercent: string } | { period: number; price: string }
      >;
      days: number;
      quantity: number;
    }

    const CASES: Case[] = [
      {
        name: "EUR, 5.35 a day for one day, two of them, 50 % off: 2.675 a unit",
        settings: {},
        product: { price: "5.35", promotion: { percentage: 50, ...ALWAYS } },
        days: 1,
        quantity: 2,
      },
      {
        name: "JPY, ¥101 a day for one day, 50 % off: a line of ¥50.50",
        settings: { currency: "JPY" },
        product: { price: "101.00", promotion: { percentage: 50, ...ALWAYS } },
        days: 1,
        quantity: 1,
      },
      {
        name: "a duration tier and a promotion, three days, two of them",
        settings: {},
        product: { price: "9.90", promotion: { percentage: 15, ...ALWAYS } },
        tiers: [{ minDuration: 3, discountPercent: "12.500000" }],
        days: 3,
        quantity: 2,
      },
      {
        name: "a rate-based product, four days, three of them, 10 % off",
        settings: {},
        product: {
          price: "12.00",
          basePeriodMinutes: 24 * 60,
          promotion: { percentage: 10, ...ALWAYS },
        },
        tiers: [{ period: 3 * 24 * 60, price: "29.90" }],
        days: 4,
        quantity: 3,
      },
      {
        name: "a fixed price, three of them, 20 % off",
        settings: {},
        product: {
          price: "19.99",
          pricingKind: "fixed",
          promotion: { percentage: 20, ...ALWAYS },
        },
        days: 2,
        quantity: 3,
      },
      {
        name: "a product at its own 5.5 % in a store that prices before tax at 20 %, 50 % off",
        settings: { tax: BEFORE_TAX },
        product: {
          price: "7.15",
          taxSettings: { inheritFromStore: false, customRate: 5.5 },
          promotion: { percentage: 50, ...ALWAYS },
        },
        days: 3,
        quantity: 2,
      },
      {
        name: "no promotion, JPY, prices before tax",
        settings: { currency: "JPY", tax: BEFORE_TAX },
        product: { price: "333.00" },
        days: 1,
        quantity: 1,
      },
    ];

    async function catalogueProduct(spec: Case) {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: "Kayak",
        price: "10.00",
        pricingMode: "day",
        quantity: 50,
        ...spec.product,
      });
      for (const [index, tier] of (spec.tiers ?? []).entries()) {
        await louezDb.db.insert(louezDb.productPricingTiers).values({
          id: nextId("tie"),
          productId: id,
          displayOrder: index,
          ...tier,
        });
      }
      return id;
    }

    /** What a reservation stores of its money, and of its one line. */
    async function storedRow(reservationId: string) {
      const r = louezDb.reservations;
      const i = louezDb.reservationItems;
      const [row] = await louezDb.db.select().from(r).where(eq(r.id, reservationId));
      const [line] = await louezDb.db.select().from(i).where(eq(i.reservationId, reservationId));
      assert.ok(row && line);
      return {
        reservation: {
          currency: row.currency,
          subtotalAmount: row.subtotalAmount,
          depositAmount: row.depositAmount,
          totalAmount: row.totalAmount,
          subtotalExclTax: row.subtotalExclTax,
          taxAmount: row.taxAmount,
          taxRate: row.taxRate,
          taxDisplayMode: row.taxDisplayMode,
        },
        line: {
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          depositPerUnit: line.depositPerUnit,
          totalPrice: line.totalPrice,
          pricingBreakdown: line.pricingBreakdown,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          priceExclTax: line.priceExclTax,
          totalExclTax: line.totalExclTax,
          taxExempt: line.taxExempt,
        },
      };
    }

    /** The same booking by hand and through the checkout (a trusted caller, nothing paid). */
    async function bookBoth(spec: Case) {
      const productId = await catalogueProduct(spec);
      const end = new Date(START.getTime() + spec.days * DAY);
      return withSettings(spec.settings, async () => {
        const byHand = await actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: end,
          items: [{ productId, quantity: spec.quantity }],
          sendConfirmationEmail: false,
        });
        assert.ok(byHand.reservationId, JSON.stringify(byHand));
        const byCheckout = await checkout.createReservation({
          source: "phone",
          storeId: STORE,
          customer: { email: "caller@example.test", firstName: "Call", lastName: "In" },
          items: [
            {
              lineId: "0",
              productId,
              quantity: spec.quantity,
              startDate: START.toISOString(),
              endDate: end.toISOString(),
              unitPrice: 0,
              depositPerUnit: 0,
            },
          ],
          subtotalAmount: 0,
          depositAmount: 0,
          totalAmount: 0,
        });
        assert.ok(byCheckout.ok, JSON.stringify(byCheckout));
        return {
          productId,
          byHand: await storedRow(byHand.reservationId),
          byCheckout: await storedRow(byCheckout.reservationId),
        };
      });
    }

    for (const spec of CASES) {
      test(`${spec.name}: the same stored row`, async () => {
        const { byHand, byCheckout } = await bookBoth(spec);
        assert.deepEqual(byHand, byCheckout);
      });
    }

    test("the reviewer's figures: 2.67 a unit in EUR, a line of ¥50.50", async () => {
      const [euros, yen] = [await bookBoth(CASES[0]!), await bookBoth(CASES[1]!)];
      assert.deepEqual(
        [euros.byHand.line.unitPrice, euros.byHand.line.totalPrice],
        ["2.67", "5.35"],
      );
      assert.equal(yen.byHand.line.totalPrice, "50.50");
    });

    test("a paid hand-created promoted line in yen is extended automatically, not left to the store", async () => {
      const { byHand } = await bookBoth(CASES[1]!);
      const reservationId = await withSettings({ currency: "JPY" }, async () => {
        const productId = await catalogueProduct(CASES[1]!);
        const created = await actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: new Date(START.getTime() + DAY),
          items: [{ productId, quantity: 1 }],
          sendConfirmationEmail: false,
        });
        assert.ok(created.reservationId, JSON.stringify(created));
        return created.reservationId;
      });
      // Paid in full, in yen.
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay"),
        reservationId,
        amount: byHand.reservation.totalAmount,
        type: "rental",
        method: "cash",
        status: "completed",
        currency: "JPY",
      });
      // The store takes payments online: a supplement can be charged.
      await louezDb.db
        .update(louezDb.stores)
        .set({ stripeAccountId: "acct_creations", stripeChargesEnabled: true })
        .where(eq(louezDb.stores.id, STORE));
      try {
        const quoted = await withSettings({ currency: "JPY" }, () =>
          extension.runExtensionQuote({ storeId: STORE, reservationId }, (tx, reservation) =>
            extension.quoteExtension(tx, reservation, new Date(START.getTime() + 2 * DAY)),
          ),
        );
        assert.notEqual(
          quoted.preview.mode === "manual" ? quoted.preview.reason : null,
          "manualPrice",
        );
        assert.ok(quoted.plan, JSON.stringify(quoted.preview));
      } finally {
        await louezDb.db
          .update(louezDb.stores)
          .set({ stripeAccountId: null, stripeChargesEnabled: false })
          .where(eq(louezDb.stores.id, STORE));
      }
    });
  });

  describe("the total the form shows is the server's", () => {
    const HOUR = 60 * MINUTE;
    const ALWAYS = { startsOn: null, endsOn: null };
    const BEFORE_TAX = { enabled: true, defaultRate: 20, displayMode: "exclusive" as const };
    const WITH_TAX = { enabled: true, defaultRate: 20, displayMode: "inclusive" as const };

    interface Shape {
      name: string;
      product: Partial<typeof louezDb.products.$inferInsert>;
      tiers?: Array<
        { minDuration: number; discountPercent: string } | { period: number; price: string }
      >;
      /** Seasons over the window, each with its own price and tiers. */
      seasons?: Array<{
        startDate: string;
        endDate: string;
        price: string;
        tiers?: Array<{ minDuration: number; discountPercent: string }>;
      }>;
      settings: Partial<StoreSettings>;
      hours: number;
      quantity: number;
      priceOverride?: number;
    }

    const SHAPES: Shape[] = [
      {
        name: "the reviewer's: 0.29 a day, a 50 % tier landing on a half cent, a 1 % promotion",
        product: { price: "0.29", promotion: { percentage: 1, ...ALWAYS } },
        tiers: [{ minDuration: 1, discountPercent: "50.000000" }],
        settings: {},
        hours: 24,
        quantity: 1,
      },
      {
        name: "the same half cent with no promotion at all",
        product: { price: "0.29" },
        tiers: [{ minDuration: 1, discountPercent: "50.000000" }],
        settings: {},
        hours: 24,
        quantity: 1,
      },
      {
        name: "a half cent from a 12.5 % tier, three of them, prices with tax",
        product: { price: "1.13" },
        tiers: [{ minDuration: 2, discountPercent: "12.500000" }],
        settings: { tax: WITH_TAX },
        hours: 48,
        quantity: 3,
      },
      {
        name: "an hourly product over five hours and a half, 15 % off, before tax",
        product: { price: "3.35", pricingMode: "hour", promotion: { percentage: 15, ...ALWAYS } },
        settings: { tax: BEFORE_TAX },
        hours: 5.5,
        quantity: 2,
      },
      {
        name: "a weekly product over ten days, in yen, 50 % off",
        product: {
          price: "1001.00",
          pricingMode: "week",
          promotion: { percentage: 50, ...ALWAYS },
        },
        settings: { currency: "JPY" },
        hours: 240,
        quantity: 1,
      },
      {
        name: "rates with strict packages, 10 % off",
        product: {
          price: "12.35",
          basePeriodMinutes: 24 * 60,
          enforceStrictTiers: true,
          promotion: { percentage: 10, ...ALWAYS },
        },
        tiers: [{ period: 3 * 24 * 60, price: "29.95" }],
        settings: { tax: BEFORE_TAX },
        hours: 96,
        quantity: 2,
      },
      {
        name: "rates prorated over a partial period, in yen",
        product: { price: "333.00", basePeriodMinutes: 24 * 60 },
        tiers: [{ period: 3 * 24 * 60, price: "777.00" }],
        settings: { currency: "JPY", tax: WITH_TAX },
        hours: 100,
        quantity: 1,
      },
      {
        name: "two seasons overlapping each other and the window, a tier in one, 25 % off",
        product: { price: "9.99", promotion: { percentage: 25, ...ALWAYS } },
        seasons: [
          {
            startDate: "2031-06-01",
            endDate: "2031-06-11",
            price: "7.77",
            tiers: [{ minDuration: 2, discountPercent: "12.500000" }],
          },
          { startDate: "2031-06-11", endDate: "2031-06-20", price: "3.33" },
        ],
        settings: {},
        hours: 72,
        quantity: 3,
      },
      {
        name: "a fixed price at a half cent of a promotion, prices with tax",
        product: { price: "0.25", pricingKind: "fixed", promotion: { percentage: 50, ...ALWAYS } },
        settings: { tax: WITH_TAX },
        hours: 24,
        quantity: 1,
      },
      {
        name: "a price typed by hand at a half cent, a promotion not applied to it",
        product: { price: "10.00", promotion: { percentage: 50, ...ALWAYS } },
        settings: {},
        hours: 72,
        quantity: 3,
        priceOverride: 0.015,
      },
    ];

    async function shapedProduct(shape: Shape) {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: "Board",
        price: "10.00",
        pricingMode: "day",
        quantity: 50,
        ...shape.product,
      });
      for (const [index, tier] of (shape.tiers ?? []).entries()) {
        await louezDb.db
          .insert(louezDb.productPricingTiers)
          .values({ id: nextId("tie"), productId: id, displayOrder: index, ...tier });
      }
      for (const season of shape.seasons ?? []) {
        const seasonId = nextId("sea");
        await louezDb.db.insert(louezDb.productSeasonalPricing).values({
          id: seasonId,
          productId: id,
          name: season.startDate,
          startDate: season.startDate,
          endDate: season.endDate,
          price: season.price,
        });
        for (const [index, tier] of (season.tiers ?? []).entries()) {
          await louezDb.db.insert(louezDb.productSeasonalPricingTiers).values({
            id: nextId("stt"),
            seasonalPricingId: seasonId,
            displayOrder: index,
            ...tier,
          });
        }
      }
      return id;
    }

    for (const shape of SHAPES) {
      test(`${shape.name}: accepted, written as shown`, async () => {
        const productId = await shapedProduct(shape);
        const end = new Date(START.getTime() + shape.hours * HOUR);
        const line = {
          productId,
          quantity: shape.quantity,
          ...(shape.priceOverride === undefined ? {} : { priceOverride: shape.priceOverride }),
        };
        const result = await withSettings(shape.settings, async () => {
          const shown = await formTotal(
            [line],
            { start: START, end, now: START },
            { ...SETTINGS, ...shape.settings },
          );
          const created = await actions.createManualReservation({
            customerId: CUSTOMER,
            startDate: START,
            endDate: end,
            items: [
              {
                productId,
                quantity: shape.quantity,
                ...(shape.priceOverride === undefined
                  ? {}
                  : { priceOverride: { unitPrice: shape.priceOverride } }),
              },
            ],
            expectedTotal: shown,
            sendConfirmationEmail: false,
          });
          return { shown, created };
        });

        assert.equal(result.created.error, undefined, JSON.stringify(result));
        const [row] = await louezDb.db
          .select({ total: louezDb.reservations.totalAmount })
          .from(louezDb.reservations)
          .where(eq(louezDb.reservations.id, result.created.reservationId!));
        assert.equal(row?.total, result.shown.toFixed(2));
      });
    }
  });

  describe("a product on promotion", () => {
    // The checkout's rule for a promotion in force: the day the booking is
    // made, in the store's timezone (Europe/Paris when it has none), both of
    // the promotion's dates included. Each test stops the clock at one
    // instant for its fixtures, the form and the server: none reads the wall
    // clock.
    const PARIS = "Europe/Paris";
    const AUCKLAND = "Pacific/Auckland";
    /** 20 November 2030, 11:00 in Paris. */
    const AT = new Date("2030-11-20T10:00:00.000Z");

    /** Runs `work` with the clock stopped at `instant`. */
    async function at<T>(instant: Date, work: () => Promise<T>): Promise<T> {
      mock.timers.enable({ apis: ["Date"], now: instant });
      try {
        return await work();
      } finally {
        mock.timers.reset();
      }
    }

    /** An instant by the wall clock of a timezone. */
    const wallClock = (local: string, timezone: string) => fromZonedTime(local, timezone);

    /** A product at 5.35 a day, with this promotion. */
    async function promoted(promotion: ProductPromotion) {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: "Paddle",
        price: "5.35",
        pricingMode: "day",
        quantity: 10,
        promotion,
      });
      return id;
    }

    /** The reservation's money and its one product line, as written. */
    async function moneyOf(reservationId: string) {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      const [line] = await louezDb.db
        .select()
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, reservationId));
      assert.ok(row && line);
      return {
        subtotal: row.subtotalAmount,
        total: row.totalAmount,
        unitPrice: line.unitPrice,
        totalPrice: line.totalPrice,
        promotion: recordedPromotion(line),
      };
    }

    /** The same line booked through the checkout (a trusted caller, nothing paid). */
    async function bookedByCheckout(productId: string, quantity: number) {
      const result = await checkout.createReservation({
        source: "phone",
        storeId: STORE,
        customer: { email: "caller@example.test", firstName: "Call", lastName: "In" },
        items: [
          {
            lineId: "0",
            productId,
            quantity,
            startDate: START.toISOString(),
            endDate: END.toISOString(),
            unitPrice: 5.35,
            depositPerUnit: 0,
          },
        ],
        subtotalAmount: 0,
        depositAmount: 0,
        totalAmount: 0,
      });
      assert.ok(result.ok, JSON.stringify(result));
      return moneyOf(result.reservationId);
    }

    /**
     * Two paddles for two days, created by hand as the form sends them: the
     * form priced at `shownAt` (the instant the server gave the page), the
     * server at its own clock, `submittedAt`.
     */
    async function createdByHand(
      productId: string,
      shownAt: Date,
      submittedAt: Date,
      settings: StoreSettings,
    ) {
      const shown = await at(shownAt, () =>
        formTotal(
          [{ productId, quantity: 2 }],
          { start: START, end: END, now: new Date() },
          settings,
        ),
      );
      const result = await at(submittedAt, () =>
        actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: END,
          items: [{ productId, quantity: 2 }],
          expectedTotal: shown,
          sendConfirmationEmail: false,
        }),
      );
      return { shown, result };
    }

    test(
      "the confirmation e-mail states the line as written, the promotion applied",
      { timeout: 30_000 },
      async () => {
        // Two for two days at 5.35, 50 % off: the line is 10.70, and so is the total.
        const paddles = await promoted({ percentage: 50, startsOn: null, endsOn: null });
        const asked = new Promise<{
          items: Array<{ name: string; quantity: number; unitPrice: number; totalPrice: number }>;
          reservation: { subtotalAmount: number; totalAmount: number };
        }>((resolve) => Reflect.set(globalThis, CONFIRMATION_EMAIL_KEY, resolve));
        try {
          const result = await at(AT, () =>
            actions.createManualReservation({
              customerId: CUSTOMER,
              startDate: START,
              endDate: END,
              items: [{ productId: paddles, quantity: 2 }],
            }),
          );
          assert.ok(result.reservationId, JSON.stringify(result));
          const email = await asked;
          const written = await moneyOf(result.reservationId);

          assert.deepEqual(
            email.items.map((item) => [
              item.name,
              item.quantity,
              item.unitPrice.toFixed(2),
              item.totalPrice.toFixed(2),
            ]),
            [["Paddle", 2, written.unitPrice, written.totalPrice]],
          );
          assert.equal(written.totalPrice, "10.70");
          assert.equal(Number(email.reservation.subtotalAmount).toFixed(2), "10.70");
        } finally {
          Reflect.deleteProperty(globalThis, CONFIRMATION_EMAIL_KEY);
        }
      },
    );

    const DISCOUNTED = {
      subtotal: "10.70",
      total: "10.70",
      unitPrice: "5.35",
      totalPrice: "10.70",
      promotion: { percentage: 50, originalSubtotal: 21.4, discountAmount: 10.7 },
    };
    const FULL_PRICE = {
      subtotal: "21.40",
      total: "21.40",
      unitPrice: "10.70",
      totalPrice: "21.40",
      promotion: null,
    };

    test("in force: the line is priced with it and records it, as the checkout prices and records it", async () => {
      // Two for two days at 5.35, 50 % off: 10.70, not 21.40.
      const paddles = await promoted({
        percentage: 50,
        startsOn: "2030-11-20",
        endsOn: "2030-11-20",
      });

      const { result } = await createdByHand(paddles, AT, AT, SETTINGS);
      const byHand = await moneyOf((await writtenBy(result)).reservationId);

      assert.deepEqual(byHand, DISCOUNTED);
      assert.deepEqual(byHand, await at(AT, () => bookedByCheckout(paddles, 2)));
    });

    test("over, or not started: nothing changes, and the line records none", async () => {
      for (const promotion of [
        { percentage: 50, startsOn: "2030-11-10", endsOn: "2030-11-19" },
        { percentage: 50, startsOn: "2030-11-21", endsOn: null },
      ]) {
        const paddles = await promoted(promotion);

        const { result } = await createdByHand(paddles, AT, AT, SETTINGS);
        const byHand = await moneyOf((await writtenBy(result)).reservationId);

        assert.deepEqual(byHand, FULL_PRICE);
        assert.deepEqual(byHand, await at(AT, () => bookedByCheckout(paddles, 2)));
      }
    });

    for (const timezone of [undefined, AUCKLAND]) {
      const zone = timezone ?? PARIS;
      const store = timezone ? `a store in ${timezone}` : "a store with no timezone (Paris)";
      const boundaries = [
        {
          name: "the last second of its end",
          promotion: { percentage: 50, startsOn: null, endsOn: "2030-11-20" },
          instant: wallClock("2030-11-20T23:59:59", zone),
          expected: DISCOUNTED,
        },
        {
          name: "the first second after its end",
          promotion: { percentage: 50, startsOn: null, endsOn: "2030-11-20" },
          instant: wallClock("2030-11-21T00:00:00", zone),
          expected: FULL_PRICE,
        },
        {
          name: "the last second before its start",
          promotion: { percentage: 50, startsOn: "2030-11-20", endsOn: null },
          instant: wallClock("2030-11-19T23:59:59", zone),
          expected: FULL_PRICE,
        },
        {
          name: "the first second of its start",
          promotion: { percentage: 50, startsOn: "2030-11-20", endsOn: null },
          instant: wallClock("2030-11-20T00:00:00", zone),
          expected: DISCOUNTED,
        },
      ];
      for (const boundary of boundaries) {
        test(`${store}, at ${boundary.name}: priced as the checkout prices it at that second`, async () => {
          const paddles = await promoted(boundary.promotion);
          const settings = { ...SETTINGS, ...(timezone ? { timezone } : {}) };

          const { byHand, byCheckout } = await withSettings(settings, async () => {
            const { result } = await createdByHand(
              paddles,
              boundary.instant,
              boundary.instant,
              settings,
            );
            return {
              byHand: await moneyOf((await writtenBy(result)).reservationId),
              byCheckout: await at(boundary.instant, () => bookedByCheckout(paddles, 2)),
            };
          });

          assert.deepEqual(byHand, boundary.expected);
          assert.deepEqual(byHand, byCheckout);
        });
      }
    }

    test("the page loaded before midnight, sent after the promotion ended: refused once, then accepted at the reloaded price", async () => {
      const paddles = await promoted({ percentage: 50, startsOn: null, endsOn: "2030-11-20" });
      const loaded = wallClock("2030-11-20T23:59:30", PARIS);
      const sent = wallClock("2030-11-21T00:00:10", PARIS);
      const before = await storeCounts();

      // The form shows the promotion the server's instant had in force.
      const first = await createdByHand(paddles, loaded, sent, SETTINGS);
      assert.equal(first.shown, 10.7);
      assert.equal(first.result.error, "errors.reservationChangedMeanwhile");
      assert.deepEqual(await storeCounts(), before, "nothing written");

      // The refusal reloads the page: its new instant is the server's, after midnight.
      const second = await createdByHand(paddles, sent, sent, SETTINGS);
      assert.equal(second.shown, 21.4);
      assert.deepEqual(await moneyOf((await writtenBy(second.result)).reservationId), FULL_PRICE);
    });

    test("the form's price does not follow the browser's clock, only the instant the server gave it", async () => {
      const paddles = await promoted({ percentage: 50, startsOn: null, endsOn: "2030-11-20" });
      const product = await formProductOf(paddles);
      // The browser's clock reads a year later; the page was given AT.
      const shown = await at(new Date("2031-11-20T10:00:00.000Z"), async () =>
        productLinePricing({
          product,
          selectedItem: { lineId: "0", productId: paddles, quantity: 2 },
          startDate: START,
          endDate: END,
          timezone: undefined,
          now: AT,
        }),
      );
      assert.equal(shown.lineSubtotal, 10.7);
    });

    test("a price typed by hand is not discounted", async () => {
      const paddles = await promoted({ percentage: 50, startsOn: null, endsOn: null });

      const result = await at(AT, async () =>
        actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: END,
          // 8.00 a day, typed, for two days.
          items: [{ productId: paddles, quantity: 1, priceOverride: { unitPrice: 8 } }],
          expectedTotal: await formTotal(
            [{ productId: paddles, quantity: 1, priceOverride: 8 }],
            { start: START, end: END, now: AT },
            SETTINGS,
          ),
          sendConfirmationEmail: false,
        }),
      );

      const typed = await moneyOf((await writtenBy(result)).reservationId);
      assert.equal(typed.totalPrice, "16.00");
      assert.equal(typed.total, "16.00");
      assert.ok(
        typed.promotion === NOT_RECORDED || typed.promotion === null,
        "no promotion applied to a typed price",
      );
    });

    test("the total the form shows is the total written, the promotion included", async () => {
      const paddles = await promoted({ percentage: 50, startsOn: null, endsOn: null });

      const { shown, result } = await createdByHand(paddles, AT, AT, SETTINGS);

      const written = await moneyOf((await writtenBy(result)).reservationId);
      assert.equal(shown.toFixed(2), written.total);
      assert.equal(written.total, (await at(AT, () => bookedByCheckout(paddles, 2))).total);
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

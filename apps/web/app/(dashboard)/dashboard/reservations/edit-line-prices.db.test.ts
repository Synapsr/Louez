import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type { PricingBreakdown, StoreSettings, TaxSettings } from "@louez/types";

import { STORE_KEY } from "./actions-test-stubs";

// The line prices of a reservation the store edits from the dashboard
// (docs/domain/reservation-changes.md, slice 11): which lines are priced
// again, and from what.

const STORE = "store_line_prices";
const CUSTOMER = "customer_line_prices";
const DAY = 86_400_000;
const START = new Date("2031-06-10T09:00:00.000Z");
const TWO_DAYS = new Date(START.getTime() + 2 * DAY);
const THREE_DAYS = new Date(START.getTime() + 3 * DAY);
const FOUR_DAYS = new Date(START.getTime() + 4 * DAY);

const HT: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "exclusive" };

// The insurer is not connected: no edit here asks for insurance.
const INSURER_STUBS: Record<string, string> = {
  "@/lib/integrations/tulip/state": `export async function resolveTulipIntegrationForStore() {
    return { settings: { enabled: false, connectedAt: null, publicMode: "no_public", renterUid: null } };
  }\n`,
  "@/lib/integrations/tulip/contracts": `export async function previewTulipQuoteForCheckout() { throw new Error("no insurer in tests"); }
  export async function getTulipCoverageSummary() { return { insuredProductCount: 0, uninsuredProductCount: 0, insuredProductIds: [] }; }
  export async function createTulipContractForReservation() {}
  export async function syncTulipContractForReservation() {}\n`,
};
const INSURER_SCHEME = "louez-edit-line-prices-insurer:";
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

/** A breakdown as the checkout or an earlier edit wrote it for a day-priced line. */
const breakdownOf = (
  duration: number,
  price: number,
  extra: Partial<PricingBreakdown> = {},
): PricingBreakdown => ({
  basePrice: price,
  effectivePrice: price,
  duration,
  pricingMode: "day",
  pricingKind: "duration",
  discountPercent: null,
  discountAmount: 0,
  tierApplied: null,
  taxRate: null,
  taxAmount: null,
  subtotalExclTax: null,
  subtotalInclTax: null,
  ...extra,
});

interface Line {
  productId: string;
  quantity: number;
  totalPrice: string;
  breakdown?: PricingBreakdown | null;
  taxRate?: string | null;
}

describe(
  "the line prices of an edit (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let actions: typeof import("./actions");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, "0")}`;

    /** The store's settings, on its row and in the session the action reads. */
    async function useStore(settings: Partial<StoreSettings>) {
      const merged = {
        reservationMode: "request" as const,
        advanceNoticeMinutes: 0,
        currency: "EUR",
        ...settings,
      } as StoreSettings;
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: merged })
        .where(eq(louezDb.stores.id, STORE));
      Reflect.set(globalThis, STORE_KEY, {
        id: STORE,
        userId: "",
        name: "Edit line prices",
        slug: "edit-line-prices",
        address: null,
        latitude: null,
        longitude: null,
        settings: merged,
        stripeAccountId: null,
      });
    }

    before(async () => {
      database = await createTestDatabase("edit_line_prices");
      louezDb = await import("@louez/db");
      actions = await import("./actions");
      await import("@louez/mcp/testing/cjs-named-exports");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_line_prices",
        name: "Edit line prices",
        slug: "edit-line-prices",
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "renter@example.test",
        firstName: "Renter",
        lastName: "Test",
      });
    });

    after(async () => {
      Reflect.deleteProperty(globalThis, STORE_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** A product priced by the day. */
    async function product(price = "10.00") {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: `Kayak ${id}`,
        price,
        pricingMode: "day",
        quantity: 20,
      });
      return id;
    }

    /** A confirmed reservation from START to `end`, with these lines as stored. */
    async function booking(
      lines: Line[],
      options: { end?: Date; taxDisplayMode?: "inclusive" | "exclusive" | null } = {},
    ) {
      const id = nextId("res");
      const total = lines.reduce((sum, line) => sum + Number(line.totalPrice), 0).toFixed(2);
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: id,
        status: "confirmed",
        startDate: START,
        endDate: options.end ?? TWO_DAYS,
        subtotalAmount: total,
        depositAmount: "0.00",
        totalAmount: total,
        currency: "EUR",
        taxDisplayMode: options.taxDisplayMode ?? null,
        source: "online",
      });
      const itemIds: string[] = [];
      for (const line of lines) {
        const itemId = nextId("itm");
        itemIds.push(itemId);
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: itemId,
          reservationId: id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: (Number(line.totalPrice) / line.quantity).toFixed(2),
          depositPerUnit: "0.00",
          totalPrice: line.totalPrice,
          taxRate: line.taxRate ?? null,
          productSnapshot: { name: `Line ${itemId}`, description: null, images: [] },
          pricingBreakdown: line.breakdown ?? null,
        });
      }
      return { id, itemIds };
    }

    /** The lines as the form sends them: every line, the given quantities. */
    const formLines = async (reservationId: string, quantities: Record<string, number> = {}) =>
      (await items(reservationId)).map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: quantities[item.id] ?? item.quantity,
        unitPrice: Number(item.unitPrice),
        depositPerUnit: 0,
        isManualPrice: false,
        pricingMode: "day" as const,
        productSnapshot: { name: item.productSnapshot.name },
      }));

    const items = (reservationId: string) =>
      louezDb.db
        .select()
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, reservationId))
        .orderBy(asc(louezDb.reservationItems.id));

    const reservationRow = async (reservationId: string) => {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      assert.ok(row);
      return row;
    };

    const deleteProduct = (productId: string) =>
      louezDb.db.delete(louezDb.products).where(eq(louezDb.products.id, productId));

    describe("a line the edit does not change", () => {
      test("keeps its price when another line changes, whatever its product's price did since", async () => {
        await useStore({});
        const [kayak, canoe] = [await product(), await product()];
        // Two days at 10.00 each, as booked.
        const { id, itemIds } = await booking([
          { productId: kayak, quantity: 1, totalPrice: "20.00" },
          { productId: canoe, quantity: 1, totalPrice: "20.00" },
        ]);
        await louezDb.db
          .update(louezDb.products)
          .set({ price: "15.00" })
          .where(eq(louezDb.products.id, kayak));

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[1]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        const [kayakLine, canoeLine] = await items(id);
        // Today: priced again from the catalogue, 2 × 15.00.
        assert.equal(kayakLine?.totalPrice, "30.00");
        assert.equal(canoeLine?.totalPrice, "40.00");
      });

      test("keeps its tax rate when another line changes, whatever the store's rate did since", async () => {
        await useStore({ tax: HT });
        const [kayak, canoe] = [await product(), await product()];
        const { id, itemIds } = await booking(
          [
            { productId: kayak, quantity: 1, totalPrice: "20.00", taxRate: "20.00" },
            { productId: canoe, quantity: 1, totalPrice: "20.00", taxRate: "20.00" },
          ],
          { taxDisplayMode: "exclusive" },
        );
        await useStore({ tax: { ...HT, defaultRate: 10 } });

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[1]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        const [kayakLine, canoeLine] = await items(id);
        // Today: the store's rate of now on every line.
        assert.equal(kayakLine?.taxRate, "10.00");
        assert.equal(canoeLine?.taxRate, "10.00");
      });
    });

    describe("a line priced again that recorded its promotion", () => {
      test("its window moved: the promotion recorded is applied to the new price", async () => {
        await useStore({});
        const kayak = await product();
        // Two days at 10.00, 20 % off: 16.00.
        const { id } = await booking([
          {
            productId: kayak,
            quantity: 1,
            totalPrice: "16.00",
            breakdown: breakdownOf(2, 10, {
              promotion: { percentage: 20, originalSubtotal: 20, discountAmount: 4 },
            }),
          },
        ]);

        const result = await actions.updateReservation(id, {
          endDate: THREE_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        const [line] = await items(id);
        // Today: three days at 10.00, the promotion dropped.
        assert.equal(line?.totalPrice, "30.00");
        assert.equal(line?.pricingBreakdown?.promotion, undefined);
      });

      test("a recorded 'none' stays recorded", async () => {
        await useStore({});
        const kayak = await product();
        const { id } = await booking([
          {
            productId: kayak,
            quantity: 1,
            totalPrice: "20.00",
            breakdown: breakdownOf(2, 10, { promotion: null, factsOnly: true }),
          },
        ]);

        const result = await actions.updateReservation(id, {
          endDate: THREE_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        const [line] = await items(id);
        assert.equal(line?.totalPrice, "30.00");
        // Today: the breakdown written again without the fact.
        assert.equal(line?.pricingBreakdown && "promotion" in line.pricingBreakdown, false);
      });
    });

    describe("a line whose product was deleted since", () => {
      /** Three days at 30.00 of a product deleted since: 90.00. */
      async function goneLine(breakdown: PricingBreakdown | null = breakdownOf(3, 30)) {
        const [gone, other] = [await product("30.00"), await product()];
        const booked = await booking(
          [
            { productId: gone, quantity: 1, totalPrice: "90.00", breakdown },
            { productId: other, quantity: 1, totalPrice: "30.00" },
          ],
          { end: THREE_DAYS },
        );
        await deleteProduct(gone);
        return booked;
      }

      test("untouched while another line changes", async () => {
        await useStore({});
        const { id, itemIds } = await goneLine();

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[1]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        const [gone] = await items(id);
        // Today: its whole-period price taken for a daily one, 90.00 × 3.
        assert.equal(gone?.totalPrice, "270.00");
      });

      test("its quantity changed", async () => {
        await useStore({});
        const { id, itemIds } = await goneLine();

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[0]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        const [gone] = await items(id);
        // Today: 90.00 × 3 days × 2.
        assert.equal(gone?.totalPrice, "540.00");
      });

      test("its window moved, its booked duration recorded", async () => {
        await useStore({});
        const { id } = await goneLine();

        const result = await actions.updateReservation(id, {
          endDate: FOUR_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        const [gone] = await items(id);
        // Today: 90.00 × 4 days.
        assert.equal(gone?.totalPrice, "360.00");
      });

      test("its window moved, its booked duration not recorded", async () => {
        await useStore({});
        const { id } = await goneLine(null);

        const result = await actions.updateReservation(id, {
          endDate: FOUR_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        const [gone] = await items(id);
        assert.equal(gone?.totalPrice, "360.00");
        assert.equal((await reservationRow(id)).endDate.getTime(), FOUR_DAYS.getTime());
      });
    });
  },
);

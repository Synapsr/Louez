import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type { PricingBreakdown, StoreSettings, TaxSettings } from "@louez/types";

import { storedProductLineOf } from "@louez/api/services/edit-line-pricing";
import { pricingBasisOf } from "@louez/api/services/pricing-facts";

import type { EditableItem } from "./[id]/edit/types";
import {
  calculateEditableItemPrice,
  previewEditTotal,
} from "./[id]/edit/hooks/use-edit-reservation-pricing";
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

    /**
     * The total the edit form shows for an edit, from the reservation as
     * stored, its lines built as the form builds them (`toEditableItem`).
     */
    async function previewOf(
      reservationId: string,
      edit: { end?: Date; quantities?: Record<string, number> },
    ) {
      const row = await reservationRow(reservationId);
      const end = edit.end ?? row.endDate;
      const [store] = await louezDb.db
        .select({ settings: louezDb.stores.settings })
        .from(louezDb.stores)
        .where(eq(louezDb.stores.id, STORE));
      const editable: EditableItem[] = [];
      for (const item of await items(reservationId)) {
        const [product] = item.productId
          ? await louezDb.db
              .select()
              .from(louezDb.products)
              .where(eq(louezDb.products.id, item.productId))
          : [];
        const basis = pricingBasisOf(item.pricingBreakdown);
        editable.push({
          id: item.id,
          productId: item.productId,
          quantity: edit.quantities?.[item.id] ?? item.quantity,
          consumedQuantity: 0,
          unitPrice: Number(item.unitPrice),
          depositPerUnit: 0,
          isManualPrice: basis?.isManualOverride === true,
          pricingMode: product?.pricingMode ?? basis?.pricingMode ?? "day",
          productSnapshot: item.productSnapshot,
          product: product
            ? {
                id: product.id,
                name: product.name,
                price: product.price,
                deposit: product.deposit ?? "0.00",
                quantity: product.quantity,
                stockKind: product.stockKind,
                pricingKind: product.pricingKind,
                pricingMode: product.pricingMode,
                basePeriodMinutes: product.basePeriodMinutes,
                enforceStrictTiers: product.enforceStrictTiers,
                taxSettings: product.taxSettings,
                pricingTiers: [],
                seasonalPricings: [],
              }
            : null,
          stored: item.productId ? storedProductLineOf(item) : null,
        });
      }
      const windowChanged = end.getTime() !== row.endDate.getTime();
      const calculated = editable.map((item) => ({
        ...item,
        ...calculateEditableItemPrice(item, row.startDate, end, undefined, windowChanged),
      }));
      return previewEditTotal({
        items: calculated,
        insuranceAmount: 0,
        discountAmount: 0,
        deliveryFee: 0,
        deposit: 0,
        storeTax: store?.settings?.tax,
        recordedTaxDisplayMode: row.taxDisplayMode,
        currency: "EUR",
      }).toFixed(2);
    }

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
        // As booked, 2 × 10.00; the line changed is priced at today's 10.00 a day.
        assert.equal(kayakLine?.totalPrice, "20.00");
        assert.equal(kayakLine?.unitPrice, "20.00");
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
        const shown = await previewOf(id, { quantities: { [itemIds[1]!]: 2 } });

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[1]!]: 2 }),
        });
        assert.equal(shown, (await reservationRow(id)).totalAmount, "the form showed what is written");

        assert.equal(result.error, undefined);
        const [kayakLine, canoeLine] = await items(id);
        // The line kept keeps its rate and its tax; the line changed gets today's.
        assert.equal(kayakLine?.taxRate, "20.00");
        assert.equal(kayakLine?.taxAmount, "4.00");
        assert.equal(canoeLine?.taxRate, "10.00");
        // 20.00 + 4.00 of tax, and 40.00 + 4.00.
        assert.equal((await reservationRow(id)).totalAmount, "68.00");
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

        const shown = await previewOf(id, { end: THREE_DAYS });

        const result = await actions.updateReservation(id, {
          endDate: THREE_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        assert.equal(shown, (await reservationRow(id)).totalAmount, "the form showed what is written");
        const [line] = await items(id);
        // Three days at 10.00, the promotion of 20 % taken off as recorded, though
        // the product holds no promotion any more.
        assert.equal(line?.totalPrice, "24.00");
        assert.deepEqual(line?.pricingBreakdown?.promotion, {
          percentage: 20,
          originalSubtotal: 30,
          discountAmount: 6,
        });
        assert.equal((await reservationRow(id)).totalAmount, "24.00");
      });

      test("its quantity changed: the promotion recorded is applied to the new price", async () => {
        await useStore({});
        const kayak = await product();
        const { id, itemIds } = await booking([
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
          items: await formLines(id, { [itemIds[0]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        const [line] = await items(id);
        // Two for two days at 10.00, 40.00, less 20 %.
        assert.equal(line?.totalPrice, "32.00");
      });

      test("its window moved through a date change alone: the promotion recorded is applied", async () => {
        await useStore({});
        const kayak = await product();
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

        const result = await actions.updateReservation(id, { endDate: THREE_DAYS });

        assert.equal(result.error, undefined);
        const [line] = await items(id);
        assert.equal(line?.totalPrice, "24.00");
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
        assert.equal(line?.pricingBreakdown?.promotion, null);
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
        // Untouched, it keeps its stored price (the rule of a line the edit does not change).
        assert.equal(gone?.totalPrice, "90.00");
      });

      test("its quantity changed", async () => {
        await useStore({});
        const { id, itemIds } = await goneLine();
        const shown = await previewOf(id, { quantities: { [itemIds[0]!]: 2 } });

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[0]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        // 180.00 for the line, the other kept at 30.00.
        assert.equal(shown, "210.00");
        assert.equal(shown, (await reservationRow(id)).totalAmount, "the form showed what is written");
        const [gone] = await items(id);
        // Its price per unit for the whole window, 90.00, twice.
        assert.equal(gone?.totalPrice, "180.00");
        assert.equal(gone?.unitPrice, "90.00");
      });

      test("its window moved, its booked duration recorded", async () => {
        await useStore({});
        const { id } = await goneLine();
        const shown = await previewOf(id, { end: FOUR_DAYS });

        const result = await actions.updateReservation(id, {
          endDate: FOUR_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        // 120.00 for the line, the other priced again at 40.00.
        assert.equal(shown, "160.00");
        assert.equal(shown, (await reservationRow(id)).totalAmount, "the form showed what is written");
        const [gone] = await items(id);
        // 90.00 for three days is 30.00 a day: four days, 120.00, now a price typed by hand.
        assert.equal(gone?.totalPrice, "120.00");
        assert.equal(gone?.unitPrice, "30.00");
        assert.equal(gone?.pricingBreakdown?.isManualOverride, true);
        assert.equal(gone?.pricingBreakdown?.duration, 4);
        assert.deepEqual(
          result.warnings?.filter((warning) => warning.key === "errors.editProductGoneRepriced"),
          [{ key: "errors.editProductGoneRepriced", params: { name: gone?.productSnapshot.name } }],
        );
      });

      test("its window moved, its duration recorded by a breakdown of facts only: priced by hand from then on", async () => {
        await useStore({});
        const { id } = await goneLine(breakdownOf(3, 30, { promotion: null, factsOnly: true }));

        const result = await actions.updateReservation(id, { endDate: FOUR_DAYS });

        assert.equal(result.error, undefined);
        const [gone] = await items(id);
        assert.equal(gone?.totalPrice, "120.00");
        // A full breakdown now: a later edit reads its price typed by hand.
        assert.equal(gone?.pricingBreakdown?.factsOnly, undefined);
        assert.equal(gone?.pricingBreakdown?.isManualOverride, true);
      });

      test("its window moved through a date change alone, its booked duration recorded", async () => {
        await useStore({});
        const { id } = await goneLine();

        const result = await actions.updateReservation(id, { endDate: FOUR_DAYS });

        assert.equal(result.error, undefined);
        const [gone] = await items(id);
        assert.equal(gone?.totalPrice, "120.00");
      });

      test("its window moved, its booked duration not recorded", async () => {
        await useStore({});
        const { id } = await goneLine(null);

        const result = await actions.updateReservation(id, {
          endDate: FOUR_DAYS,
          items: await formLines(id),
        });

        // No price follows from what it recorded: refused, nothing written.
        assert.equal(result.error, "errors.editProductGonePriceUnknown");
        const [gone] = await items(id);
        assert.equal(gone?.totalPrice, "90.00");
        assert.equal((await reservationRow(id)).endDate.getTime(), THREE_DAYS.getTime());
      });
    });
  },
);

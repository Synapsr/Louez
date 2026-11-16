import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type {
  AppliedProductPromotion,
  PricingBreakdown,
  StoreSettings,
  TaxSettings,
} from "@louez/types";

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
    let priceCart: typeof import("@louez/api/services/price-cart");
    let reservationDates: typeof import("@louez/api/services/reservation-dates");
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
      priceCart = await import("@louez/api/services/price-cart");
      reservationDates = await import("@louez/api/services/reservation-dates");
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
    async function product(price = "10.00", pricingMode: "hour" | "day" | "week" = "day") {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: `Kayak ${id}`,
        price,
        pricingMode,
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
    /**
     * The lines as the form sends them: every line, the given quantities; a
     * price typed by hand as its price per period over the stored window.
     */
    const formLines = async (reservationId: string, quantities: Record<string, number> = {}) => {
      const row = await reservationRow(reservationId);
      return (await items(reservationId)).map((item) => {
        const basis = pricingBasisOf(item.pricingBreakdown);
        const typed = basis?.isManualOverride === true;
        const pricingMode = typed ? basis.pricingMode : ("day" as const);
        // Any started period in full, as the form counts it.
        const minutes = { hour: 60, day: 1440, week: 10_080 }[pricingMode];
        const periods = Math.max(
          1,
          Math.ceil((row.endDate.getTime() - row.startDate.getTime()) / 60_000 / minutes),
        );
        return {
          id: item.id,
          productId: item.productId,
          quantity: quantities[item.id] ?? item.quantity,
          unitPrice: typed
            ? Number(item.totalPrice) / (periods * item.quantity)
            : Number(item.unitPrice),
          depositPerUnit: 0,
          isManualPrice: typed,
          pricingMode,
          productSnapshot: { name: item.productSnapshot.name },
        };
      });
    };

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
        assert.equal(
          shown,
          (await reservationRow(id)).totalAmount,
          "the form showed what is written",
        );

        assert.equal(result.error, undefined);
        const [kayakLine, canoeLine] = await items(id);
        // The line kept keeps its rate and its tax; the line changed gets today's.
        assert.equal(kayakLine?.taxRate, "20.00");
        assert.equal(kayakLine?.taxAmount, "4.00");
        assert.equal(canoeLine?.taxRate, "10.00");
        // 20.00 + 4.00 of tax, and 40.00 + 4.00.
        assert.equal((await reservationRow(id)).totalAmount, "68.00");
      });

      test("that recorded no rate is taxed by today's settings, and the store is told", async () => {
        await useStore({ tax: HT });
        const [kayak, canoe] = [await product(), await product()];
        // Recorded before tax; the kayak line priced while taxes were off, no rate.
        const { id, itemIds } = await booking(
          [
            { productId: kayak, quantity: 1, totalPrice: "20.00", taxRate: null },
            { productId: canoe, quantity: 1, totalPrice: "20.00", taxRate: "20.00" },
          ],
          { taxDisplayMode: "exclusive" },
        );
        const shown = await previewOf(id, { quantities: { [itemIds[1]!]: 2 } });

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[1]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        const [kayakLine] = await items(id);
        // 20.00 + 4.00 of tax for the line kept, 40.00 + 8.00 for the other.
        assert.equal(kayakLine?.taxRate, "20.00");
        assert.equal(kayakLine?.taxAmount, "4.00");
        assert.equal((await reservationRow(id)).totalAmount, "72.00");
        assert.equal(shown, "72.00");
        assert.deepEqual(
          result.warnings?.filter((warning) => warning.key === "errors.editTaxAdded"),
          [{ key: "errors.editTaxAdded", params: { previousTotal: "40.00", newTotal: "72.00" } }],
        );
      });

      test("that recorded no rate, prices with tax: the tax is inside, no warning", async () => {
        await useStore({ tax: { ...HT, displayMode: "inclusive" } });
        const [kayak, canoe] = [await product(), await product()];
        const { id, itemIds } = await booking(
          [
            { productId: kayak, quantity: 1, totalPrice: "20.00", taxRate: null },
            { productId: canoe, quantity: 1, totalPrice: "20.00", taxRate: "20.00" },
          ],
          { taxDisplayMode: "inclusive" },
        );

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [itemIds[1]!]: 2 }),
        });

        assert.equal(result.error, undefined);
        assert.equal((await reservationRow(id)).totalAmount, "60.00");
        assert.equal(
          (result.warnings ?? []).some((warning) => warning.key === "errors.editTaxAdded"),
          false,
        );
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
        assert.equal(
          shown,
          (await reservationRow(id)).totalAmount,
          "the form showed what is written",
        );
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
      /**
       * A reservation the store made from the dashboard, over START to `end`:
       * the dashboard's own breakdowns (a `duration` in minutes).
       */
      async function dashboardBooking(productIds: string[], end: Date) {
        const result = await actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: end,
          items: productIds.map((productId) => ({ productId, quantity: 1 })),
          sendConfirmationEmail: false,
        });
        assert.ok(result.reservationId, JSON.stringify(result));
        return result.reservationId;
      }

      /** The line of `productId` in the reservation. */
      async function lineOf(reservationId: string, productId: string) {
        const line = (await items(reservationId)).find((item) => item.productId === productId);
        assert.ok(line);
        return line;
      }

      /**
       * A line as the checkout writes it (`checkoutLineBreakdown`): `subtotal`
       * for `duration` days of a product at 10.00 a day, with `promotion`
       * when one applied.
       */
      async function checkoutBooking(
        line: { subtotal: number; duration: number; promotion?: AppliedProductPromotion },
        end: Date,
      ) {
        const gone = await product();
        const breakdown = priceCart.checkoutLineBreakdown(
          { price: 10, pricingMode: "day" },
          {
            productId: gone,
            productName: "Kayak",
            quantity: 1,
            pricingKind: "duration",
            duration: line.duration,
            unitPrice: line.subtotal,
            depositPerUnit: 0,
            subtotal: line.subtotal,
            originalSubtotal: line.promotion?.originalSubtotal ?? line.subtotal,
            savings: line.promotion?.discountAmount ?? 0,
            totalDeposit: 0,
            taxSettings: null,
            ...(line.promotion ? { promotion: line.promotion } : {}),
          },
          { taxRate: null, taxAmount: null, priceExclTax: null, totalExclTax: null },
        );
        const { id } = await booking(
          [{ productId: gone, quantity: 1, totalPrice: line.subtotal.toFixed(2), breakdown }],
          { end },
        );
        await deleteProduct(gone);
        return { id, gone };
      }

      test("untouched while another line changes", async () => {
        await useStore({});
        const [gone, other] = [await product("30.00"), await product()];
        const id = await dashboardBooking([gone, other], THREE_DAYS);
        await deleteProduct(gone);

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [(await lineOf(id, other)).id]: 2 }),
        });

        assert.equal(result.error, undefined);
        // Untouched, it keeps its stored price (the rule of a line the edit does not change).
        assert.equal((await lineOf(id, gone)).totalPrice, "90.00");
      });

      test("its quantity changed", async () => {
        await useStore({});
        const [gone, other] = [await product("30.00"), await product()];
        const id = await dashboardBooking([gone, other], THREE_DAYS);
        await deleteProduct(gone);
        const goneId = (await lineOf(id, gone)).id;
        const shown = await previewOf(id, { quantities: { [goneId]: 2 } });

        const result = await actions.updateReservation(id, {
          items: await formLines(id, { [goneId]: 2 }),
        });

        assert.equal(result.error, undefined);
        // 180.00 for the line, the other kept at 30.00.
        assert.equal(shown, "210.00");
        assert.equal(
          shown,
          (await reservationRow(id)).totalAmount,
          "the form showed what is written",
        );
        // Its price per unit for the whole window, 90.00, twice.
        const line = await lineOf(id, gone);
        assert.equal(line.totalPrice, "180.00");
        assert.equal(line.unitPrice, "90.00");
      });

      test("the dashboard's breakdown (minutes), after a dashboard edit: priced by the day, then by hand", async () => {
        await useStore({});
        const [gone, other] = [await product(), await product()];
        // Booked for two days, extended to three by an edit: 30.00, its breakdown written again.
        const id = await dashboardBooking([gone, other], TWO_DAYS);
        assert.equal(
          (await actions.updateReservation(id, { endDate: THREE_DAYS })).error,
          undefined,
        );
        assert.equal((await lineOf(id, gone)).totalPrice, "30.00");
        await deleteProduct(gone);
        const shown = await previewOf(id, { end: FOUR_DAYS });

        const result = await actions.updateReservation(id, {
          endDate: FOUR_DAYS,
          items: await formLines(id),
        });

        assert.equal(result.error, undefined);
        // 10.00 a day over four days, and the other line priced again at 40.00.
        const line = await lineOf(id, gone);
        assert.equal(line.totalPrice, "40.00");
        assert.equal(line.unitPrice, "10.00");
        assert.equal(line.pricingBreakdown?.isManualOverride, true);
        assert.equal(shown, "80.00");
        assert.equal(
          shown,
          (await reservationRow(id)).totalAmount,
          "the form showed what is written",
        );
        assert.deepEqual(
          result.warnings?.filter((warning) => warning.key === "errors.editProductGoneRepriced"),
          [{ key: "errors.editProductGoneRepriced", params: { name: line.productSnapshot.name } }],
        );

        // Scaled once, it is a price typed by hand: a second move prices it as one.
        const again = await actions.updateReservation(id, {
          endDate: new Date(START.getTime() + 5 * DAY),
          items: await formLines(id),
        });
        assert.equal(again.error, undefined);
        assert.equal((await lineOf(id, gone)).totalPrice, "50.00");
      });

      test("an hourly product's line, by a date change alone: priced by the hour", async () => {
        await useStore({});
        const gone = await product("5.00", "hour");
        const id = await dashboardBooking([gone], new Date(START.getTime() + 2 * 3_600_000));
        await deleteProduct(gone);

        const result = await actions.updateReservation(id, {
          endDate: new Date(START.getTime() + 3 * 3_600_000),
        });

        assert.equal(result.error, undefined);
        // 10.00 for two hours, 5.00 an hour: three hours.
        assert.equal((await lineOf(id, gone)).totalPrice, "15.00");
      });

      test("a weekly product's line: priced by the week", async () => {
        await useStore({});
        const gone = await product("70.00", "week");
        const id = await dashboardBooking([gone], new Date(START.getTime() + 7 * DAY));
        await deleteProduct(gone);

        const result = await actions.updateReservation(id, {
          endDate: new Date(START.getTime() + 14 * DAY),
        });

        assert.equal(result.error, undefined);
        assert.equal((await lineOf(id, gone)).totalPrice, "140.00");
      });

      test("the checkout's breakdown of a promoted line (periods): its price per day, promotion included", async () => {
        await useStore({});
        // Two days at 10.00, 20 % off: 16.00.
        const { id, gone } = await checkoutBooking(
          {
            subtotal: 16,
            duration: 2,
            promotion: { percentage: 20, originalSubtotal: 20, discountAmount: 4 },
          },
          TWO_DAYS,
        );

        const result = await actions.updateReservation(id, { endDate: THREE_DAYS });

        assert.equal(result.error, undefined);
        assert.equal((await lineOf(id, gone)).totalPrice, "24.00");
      });

      test("the checkout's breakdown of facts only: priced by hand from then on", async () => {
        await useStore({});
        const { id, gone } = await checkoutBooking({ subtotal: 20, duration: 2 }, TWO_DAYS);

        const result = await actions.updateReservation(id, { endDate: THREE_DAYS });

        assert.equal(result.error, undefined);
        const line = await lineOf(id, gone);
        assert.equal(line.totalPrice, "30.00");
        // A full breakdown now: a later edit reads its price typed by hand.
        assert.equal(line.pricingBreakdown?.factsOnly, undefined);
        assert.equal(line.pricingBreakdown?.isManualOverride, true);
      });

      test("its price per period rounded to the cent, as a typed price: later edits leave it as written", async () => {
        await useStore({});
        // 100.00 for three days, as the checkout recorded it, beside another line.
        const gone = await product();
        const other = await product();
        const breakdown = priceCart.checkoutLineBreakdown(
          { price: 10, pricingMode: "day" },
          {
            productId: gone,
            productName: "Kayak",
            quantity: 1,
            pricingKind: "duration",
            duration: 3,
            unitPrice: 100,
            depositPerUnit: 0,
            subtotal: 100,
            originalSubtotal: 100,
            savings: 0,
            totalDeposit: 0,
            taxSettings: null,
          },
          { taxRate: null, taxAmount: null, priceExclTax: null, totalExclTax: null },
        );
        const { id } = await booking(
          [
            { productId: gone, quantity: 1, totalPrice: "100.00", breakdown },
            { productId: other, quantity: 1, totalPrice: "30.00" },
          ],
          { end: THREE_DAYS },
        );
        await deleteProduct(gone);

        assert.equal((await actions.updateReservation(id, { endDate: FOUR_DAYS })).error, undefined);
        const scaled = await lineOf(id, gone);
        // 33.33 a day, four days: 133.32.
        assert.deepEqual([scaled.unitPrice, scaled.totalPrice], ["33.33", "133.32"]);

        // An edit of another line, then an edit of nothing.
        const otherId = (await lineOf(id, other)).id;
        for (const quantities of [{ [otherId]: 2 }, {}]) {
          const result = await actions.updateReservation(id, {
            items: await formLines(id, quantities),
          });
          assert.equal(result.error, undefined);
          const line = await lineOf(id, gone);
          assert.deepEqual([line.unitPrice, line.totalPrice], [scaled.unitPrice, scaled.totalPrice]);
        }
      });

      test("a duration whose unit no writer's mark tells, or none: refused, nothing written", async () => {
        await useStore({});
        // A breakdown with no `durationMinutes` and no promotion recorded: no
        // writer of today leaves one, so its `duration` may be minutes or days.
        for (const breakdown of [breakdownOf(3, 30), null]) {
          const gone = await product("30.00");
          const { id } = await booking(
            [{ productId: gone, quantity: 1, totalPrice: "90.00", breakdown }],
            { end: THREE_DAYS },
          );
          await deleteProduct(gone);

          const result = await actions.updateReservation(id, {
            endDate: FOUR_DAYS,
            items: await formLines(id),
          });

          assert.equal(result.error, "errors.editProductGonePriceUnknown");
          assert.equal((await lineOf(id, gone)).totalPrice, "90.00");
          assert.equal((await reservationRow(id)).endDate.getTime(), THREE_DAYS.getTime());
        }
      });
    });

    describe("the total the form shows is the total written, or the edit is refused", () => {
      /** Two lines of two days at 10.00 a day: the form reads them, then shows B's quantity at two. */
      async function formShowingB() {
        await useStore({});
        const [a, b] = [await product(), await product()];
        const { id } = await booking([
          { productId: a, quantity: 1, totalPrice: "20.00" },
          { productId: b, quantity: 1, totalPrice: "20.00" },
        ]);
        const lineB = (await items(id)).find((item) => item.productId === b);
        assert.ok(lineB);
        const quantities = { [lineB.id]: 2 };
        // What the form shows and what it sends, read now.
        const shown = await previewOf(id, { quantities });
        const sent = await formLines(id, quantities);
        return { id, a, shown, sent };
      }

      test("unchanged meanwhile: the total shown is written", async () => {
        const { id, shown, sent } = await formShowingB();
        assert.equal(shown, "60.00");

        const result = await actions.updateReservation(id, {
          items: sent,
          expectedTotal: Number(shown),
        });

        assert.equal(result.error, undefined);
        assert.equal((await reservationRow(id)).totalAmount, "60.00");
      });

      test("another edit priced a line again meanwhile: refused, nothing written", async () => {
        const { id, a, shown, sent } = await formShowingB();
        // Meanwhile, the product of A costs 15.00, and another editor changes A's
        // quantity to two and back: A is priced again, at 30.00.
        await louezDb.db
          .update(louezDb.products)
          .set({ price: "15.00" })
          .where(eq(louezDb.products.id, a));
        const lineA = (await items(id)).find((item) => item.productId === a);
        assert.ok(lineA);
        for (const quantity of [2, 1]) {
          const other = await actions.updateReservation(id, {
            items: await formLines(id, { [lineA.id]: quantity }),
          });
          assert.equal(other.error, undefined);
        }
        assert.equal((await reservationRow(id)).totalAmount, "50.00");

        const result = await actions.updateReservation(id, {
          items: sent,
          expectedTotal: Number(shown),
        });

        // It would write 70.00 where the form showed 60.00.
        assert.equal(result.error, "errors.reservationChangedMeanwhile");
        assert.equal((await reservationRow(id)).totalAmount, "50.00");
      });

      test("the API's date change moved the window meanwhile: priced at the form's window, the total shown", async () => {
        const { id, shown, sent } = await formShowingB();
        // An agent moves the reservation to three days: every line priced again.
        await reservationDates.changeReservationDates(
          {
            storeId: STORE,
            userId: null,
            credential: { kind: "session", id: null },
            transport: "rpc",
            customers: true,
            reader: { storeId: STORE, currency: "EUR", customers: true, payments: true },
            store: {
              id: STORE,
              name: "Edit line prices",
              slug: "edit-line-prices",
              ownerUserId: "owner_line_prices",
            },
            ports: {
              afterCommit: () => {},
              dispatchEffects: () => {},
              emailConfigured: () => false,
            },
          },
          { id, endDate: THREE_DAYS, notifyCustomer: false },
        );
        assert.equal((await reservationRow(id)).totalAmount, "60.00");

        // The form still holds the two days it read: each line is priced again
        // for them, which gives the total it showed.
        const result = await actions.updateReservation(id, {
          startDate: START,
          endDate: TWO_DAYS,
          items: sent,
          expectedTotal: Number(shown),
        });

        assert.equal(result.error, undefined);
        assert.equal((await reservationRow(id)).totalAmount, "60.00");
      });
    });
  },
);

import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq, inArray } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";
import type { StoreSettings, TaxSettings } from "@louez/types";

import { STORE_KEY } from "./actions-test-stubs";
import { creationTotals } from "./new/utils/creation-totals";

// The totals of a reservation the store edits or creates by hand are the tax
// engine's (slice 10, M1): computed from its lines, its insurance (exempt),
// its delivery fee and its discount, as the checkout computes them, in the
// display mode the reservation recorded, and from what is read under the
// edit's locks. The engine is the oracle: each total is compared with
// `computeReservationTotals` of the lines as stored.

const STORE = "store_edit_totals";
const CUSTOMER = "customer_edit_totals";
const DAY = 86_400_000;
const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date(START.getTime() + 2 * DAY);
const INSURANCE_ITEM_NAME = "Garantie casse/vol";

const TTC: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "inclusive" };
const HT: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "exclusive" };

// The insurer, as the action sees it: connected with a quote of the amount a
// test puts under this key, and not connected while it holds none.
const INSURANCE_QUOTE_KEY = "__louezEditTotalsInsuranceQuote";
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
const INSURER_SCHEME = "louez-edit-totals-insurer:";
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

describe(
  "the totals of an edit and of a creation by hand (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let actions: typeof import("./actions");
    let totalsEngine: typeof import("@louez/api/services/reservation-totals");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, "0")}`;

    const baseSettings = { reservationMode: "request" as const, advanceNoticeMinutes: 0 };

    /** The store's settings, on its row and in the session the action reads. */
    async function useStore(settings: Partial<StoreSettings>) {
      const merged = { ...baseSettings, currency: "USD", ...settings } as StoreSettings;
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: merged })
        .where(eq(louezDb.stores.id, STORE));
      Reflect.set(globalThis, STORE_KEY, {
        id: STORE,
        userId: "",
        name: "Edit totals",
        slug: "edit-totals",
        address: null,
        latitude: null,
        longitude: null,
        settings: merged,
        stripeAccountId: null,
      });
    }

    before(async () => {
      database = await createTestDatabase("edit_totals");
      louezDb = await import("@louez/db");
      actions = await import("./actions");
      await import("@louez/mcp/testing/cjs-named-exports");
      totalsEngine = await import("@louez/api/services/reservation-totals");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner_edit_totals",
        name: "Edit totals",
        slug: "edit-totals",
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "renter@example.test",
        firstName: "Renter",
        lastName: "Test",
        address: "1 Main Street",
      });
      await useStore({});
    });

    after(async () => {
      Reflect.deleteProperty(globalThis, STORE_KEY);
      Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** A product at 10.00 a day; `zeroRated` at its own rate of 0 %. */
    async function product(zeroRated = false) {
      const id = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: `Kayak ${id}`,
        price: "10.00",
        pricingMode: "day",
        quantity: 20,
        taxSettings: zeroRated ? { inheritFromStore: false, customRate: 0 } : null,
      });
      return id;
    }

    /**
     * A confirmed reservation of two lines over START–END: two of a product at
     * the store's rate, one at 0 %; a discount and a delivery fee as given.
     */
    async function booking(
      options: {
        discount?: string;
        deliveryFee?: string;
        taxDisplayMode?: "inclusive" | "exclusive" | null;
      } = {},
    ) {
      const taxed = await product();
      const zero = await product(true);
      const id = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: id,
        status: "confirmed",
        startDate: START,
        endDate: END,
        subtotalAmount: "60.00",
        depositAmount: "0.00",
        totalAmount: "60.00",
        deliveryFee: options.deliveryFee ?? "0.00",
        discountAmount: options.discount ?? "0.00",
        currency: "USD",
        taxDisplayMode: options.taxDisplayMode ?? null,
        source: "manual",
      });
      for (const [productId, quantity, total] of [
        [taxed, 2, "40.00"],
        [zero, 1, "20.00"],
      ] as const) {
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: nextId("itm"),
          reservationId: id,
          productId,
          quantity,
          unitPrice: (Number(total) / quantity).toFixed(2),
          depositPerUnit: "0.00",
          totalPrice: total,
          productSnapshot: { name: "Kayak", description: null, images: [] },
        });
      }
      return { id, taxed, zero };
    }

    async function stored(id: string) {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, id));
      assert.ok(row, id);
      const items = await louezDb.db
        .select()
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, id))
        .orderBy(asc(louezDb.reservationItems.id));
      return { row, items };
    }

    /** What the tax engine gives for the stored lines, insurance, fee and discount, in `tax`. */
    async function assertEngineTotals(id: string, tax: TaxSettings | undefined) {
      const { row, items } = await stored(id);
      const lines = items.filter((item) => item.productSnapshot.name !== INSURANCE_ITEM_NAME);
      const products = await louezDb.db.select().from(louezDb.products);
      const taxSettingsOf = (productId: string | null) =>
        products.find((candidate) => candidate.id === productId)?.taxSettings ?? null;
      const taxedLines = lines.map((item) => ({
        subtotal: Number(item.totalPrice),
        unitPrice: Number(item.unitPrice),
        taxSettings: taxSettingsOf(item.productId),
      }));
      const expected = totalsEngine.computeReservationTotals({
        lines: taxedLines,
        insuranceAmount: Number(row.tulipInsuranceAmount ?? 0),
        discountAmount: Number(row.discountAmount ?? 0),
        deliveryFee: Number(row.deliveryFee ?? 0),
        totalDeposit: Number(row.depositAmount),
        taxSettings: tax,
      });
      const money = (value: number | null) => (value === null ? null : value.toFixed(2));
      assert.deepEqual(
        {
          subtotal: row.subtotalAmount,
          total: row.totalAmount,
          subtotalExclTax: row.subtotalExclTax,
          tax: row.taxAmount,
          taxRate: row.taxRate,
        },
        {
          subtotal: money(expected.subtotal),
          total: money(expected.total),
          subtotalExclTax: money(expected.subtotalExclTax),
          tax: money(expected.taxAmount),
          taxRate: money(expected.taxRate),
        },
        "the reservation's totals are the engine's",
      );
      for (const [index, item] of lines.entries()) {
        const fields = totalsEngine.getReservationItemTaxFields(
          expected,
          taxedLines[index]!,
          index,
        );
        assert.deepEqual(
          [item.taxRate, item.taxAmount, item.priceExclTax, item.totalExclTax],
          [
            money(fields.taxRate),
            money(fields.taxAmount),
            money(fields.priceExclTax),
            money(fields.totalExclTax),
          ],
          `line ${index}'s tax figures are the engine's`,
        );
      }
      return { row, items, expected };
    }

    const nextDay = new Date(END.getTime() + DAY);

    describe("an edit", () => {
      test("prices with tax: the total is unchanged in meaning, the tax columns are filled", async () => {
        await useStore({ tax: TTC });
        const { id } = await booking({ discount: "5.00", deliveryFee: "15.00" });

        const result = await actions.updateReservation(id, { endDate: nextDay });

        assert.equal(result.error, undefined);
        const { row, expected } = await assertEngineTotals(id, TTC);
        // Three days: 60.00 and 30.00 of lines, 15.00 of delivery, 5.00 off.
        assert.equal(row.totalAmount, "100.00");
        assert.ok(Number(expected.taxAmount) > 0);
        assert.equal(row.taxDisplayMode, "inclusive", "recorded, as it was not");
      });

      test("prices before tax: the tax comes on top, the 0 % line has none, the discount spread", async () => {
        await useStore({ tax: HT });
        const { id } = await booking({ discount: "5.00", deliveryFee: "15.00" });

        await actions.updateReservation(id, { endDate: nextDay });

        const { row, items } = await assertEngineTotals(id, HT);
        assert.ok(Number(row.totalAmount) > 100, `the tax on top: ${row.totalAmount}`);
        assert.equal(items[1]?.taxAmount, "0.00", "the 0 % line carries no tax");
        assert.equal(row.taxDisplayMode, "exclusive");
      });

      test("with insurance: an exempt line of its own, outside the tax", async () => {
        await useStore({ tax: HT });
        const { id } = await booking();
        Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
        try {
          const result = await actions.updateReservation(id, {
            endDate: nextDay,
            tulipInsuranceOptIn: true,
          });
          assert.equal(result.error, undefined);
        } finally {
          Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
        }

        const { row, items } = await assertEngineTotals(id, HT);
        assert.equal(row.tulipInsuranceAmount, "12.50");
        const insurance = items.find((item) => item.productSnapshot.name === INSURANCE_ITEM_NAME);
        assert.deepEqual(
          [insurance?.totalPrice, insurance?.taxRate, insurance?.taxAmount, insurance?.taxExempt],
          ["12.50", null, "0.00", true],
        );
      });

      test("taxes off: nothing changes but the facts recorded", async () => {
        await useStore({});
        const { id } = await booking({ discount: "5.00", deliveryFee: "15.00" });

        await actions.updateReservation(id, { endDate: nextDay });

        const { row } = await assertEngineTotals(id, undefined);
        assert.deepEqual(
          [row.totalAmount, row.taxAmount, row.subtotalExclTax, row.taxDisplayMode],
          ["100.00", null, null, "inclusive"],
        );
      });

      test("a reservation that recorded its mode keeps it after the store switched", async () => {
        await useStore({ tax: HT });
        const { id } = await booking({ taxDisplayMode: "inclusive" });

        await actions.updateReservation(id, { endDate: nextDay });

        // Priced with tax included, as booked, at today's rate.
        const { row } = await assertEngineTotals(id, TTC);
        assert.deepEqual([row.totalAmount, row.taxDisplayMode], ["90.00", "inclusive"]);
      });

      test("two edits at once: one is written, the other told to reload, and the totals are the engine's", async () => {
        await useStore({ tax: HT });
        const { id } = await booking({ discount: "5.00" });
        const [taxedLine] = (await stored(id)).items;
        assert.ok(taxedLine);

        const results = await raceOnLockedRow(database, { table: "reservations", id }, [
          () =>
            actions.updateReservation(id, {
              items: [
                {
                  id: taxedLine.id,
                  productId: taxedLine.productId,
                  quantity: 3,
                  unitPrice: 10,
                  depositPerUnit: 0,
                  productSnapshot: { name: "Kayak" },
                },
              ],
            }),
          () => actions.updateReservation(id, { endDate: nextDay }),
        ]);

        assert.deepEqual(results.map((result) => result.error ?? "written").sort(), [
          "errors.reservationChangedMeanwhile",
          "written",
        ]);
        await assertEngineTotals(id, HT);
      });

      test("a product's price changed while the edit waited: refused, nothing written", async () => {
        await useStore({ tax: HT });
        const { id, taxed } = await booking();
        const before = await stored(id);

        const [result] = await raceOnOpenTransaction(
          database,
          async (holder) => {
            await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [taxed]);
            await holder.query("UPDATE products SET price = '12.00' WHERE id = ?", [taxed]);
          },
          [() => actions.updateReservation(id, { endDate: nextDay })],
        );

        assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
        assert.deepEqual((await stored(id)).row.totalAmount, before.row.totalAmount);
      });

      test("the renter the insurer quoted changed while the edit waited: refused", async () => {
        await useStore({ tax: HT });
        const { id } = await booking();
        Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
        try {
          const [result] = await raceOnOpenTransaction(
            database,
            async (holder) => {
              await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
              await holder.query("UPDATE customers SET address = '2 Other Street' WHERE id = ?", [
                CUSTOMER,
              ]);
            },
            [() => actions.updateReservation(id, { endDate: nextDay, tulipInsuranceOptIn: true })],
          );
          assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
        } finally {
          Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
          await louezDb.db
            .update(louezDb.customers)
            .set({ address: "1 Main Street" })
            .where(eq(louezDb.customers.id, CUSTOMER));
        }
        assert.equal((await stored(id)).row.tulipInsuranceAmount, null);
      });

      test("the window the insurer quoted changed while the edit waited: refused", async () => {
        await useStore({ tax: HT });
        const { id } = await booking();
        Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
        try {
          const [result] = await raceOnOpenTransaction(
            database,
            async (holder) => {
              await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
              await holder.query("UPDATE reservations SET end_date = ? WHERE id = ?", [
                new Date(END.getTime() + 3 * DAY),
                id,
              ]);
            },
            // The edit leaves the dates as stored: it quoted the window it read.
            [() => actions.updateReservation(id, { tulipInsuranceOptIn: true })],
          );
          assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile" });
        } finally {
          Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
        }
      });
    });

    describe("an edit that changes nothing that prices the reservation", () => {
      /**
       * An old reservation made by hand in a store that prices before tax: one
       * line of 150.00, its total 150.00 with no tax, paid in full.
       */
      async function oldManualBooking(
        written: Partial<typeof louezDb.reservations.$inferInsert> = {},
      ) {
        const kayak = await product();
        const id = nextId("res");
        await louezDb.db.insert(louezDb.reservations).values({
          id,
          storeId: STORE,
          customerId: CUSTOMER,
          number: id,
          status: "confirmed",
          startDate: START,
          endDate: END,
          subtotalAmount: "150.00",
          depositAmount: "0.00",
          totalAmount: "150.00",
          deliveryFee: "0.00",
          discountAmount: "0.00",
          currency: "USD",
          source: "manual",
          ...written,
        });
        const itemId = nextId("itm");
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: itemId,
          reservationId: id,
          productId: kayak,
          quantity: 1,
          unitPrice: "75.00",
          depositPerUnit: "0.00",
          totalPrice: "150.00",
          productSnapshot: { name: "Kayak", description: null, images: [] },
          pricingBreakdown: {
            basePrice: 75,
            effectivePrice: 75,
            duration: 2,
            pricingMode: "day",
            discountPercent: null,
            discountAmount: 0,
            tierApplied: null,
            taxRate: null,
            taxAmount: null,
            subtotalExclTax: null,
            subtotalInclTax: null,
            isManualOverride: true,
          },
        });
        await louezDb.db.insert(louezDb.payments).values({
          id: nextId("pay"),
          reservationId: id,
          amount: "150.00",
          type: "rental",
          method: "cash",
          status: "completed",
          currency: "USD",
        });
        return { id, itemId, kayak };
      }

      const moneyOf = async (id: string) => {
        const { row, items } = await stored(id);
        return {
          row: [
            row.subtotalAmount,
            row.totalAmount,
            row.subtotalExclTax,
            row.taxAmount,
            row.taxRate,
            row.taxDisplayMode,
            row.depositAmount,
          ],
          items: items.map((item) => [
            item.totalPrice,
            item.unitPrice,
            item.taxRate,
            item.taxAmount,
            item.taxExempt,
          ]),
        };
      };

      test("no field at all: every amount stays as stored, nothing is recorded", async () => {
        await useStore({ tax: HT });
        const { id } = await oldManualBooking();
        const before = await moneyOf(id);

        const result = await actions.updateReservation(id, {});

        assert.equal(result.error, undefined);
        assert.deepEqual(await moneyOf(id), before);
        assert.equal(result.newTotal, 150);
      });

      test("the form's whole payload sent again unchanged: every amount stays as stored", async () => {
        await useStore({ tax: HT });
        const { id, itemId, kayak } = await oldManualBooking();
        const before = await moneyOf(id);

        const result = await actions.updateReservation(id, {
          startDate: START,
          endDate: END,
          tulipInsuranceOptIn: false,
          items: [
            {
              id: itemId,
              productId: kayak,
              quantity: 1,
              unitPrice: 75,
              depositPerUnit: 0,
              isManualPrice: true,
              pricingMode: "day",
              productSnapshot: { name: "Kayak" },
            },
          ],
        });

        assert.equal(result.error, undefined);
        assert.deepEqual(await moneyOf(id), before);
      });

      const twoKayaks = (itemId: string, kayak: string) => [
        {
          id: itemId,
          productId: kayak,
          quantity: 2,
          unitPrice: 75,
          depositPerUnit: 0,
          isManualPrice: true,
          pricingMode: "day" as const,
          productSnapshot: { name: "Kayak" },
        },
      ];

      test("a row the engine never totalled warns, whatever its tax columns hold", async () => {
        await useStore({ tax: HT });
        // Its tax columns left from an earlier pricing, its total rewritten without them.
        const { id, itemId, kayak } = await oldManualBooking({
          subtotalExclTax: "125.00",
          taxAmount: "25.00",
          taxRate: "20.00",
        });

        const result = await actions.updateReservation(id, { items: twoKayaks(itemId, kayak) });

        assert.deepEqual(result.warnings, [
          {
            key: "errors.editTaxAdded",
            params: { previousTotal: "150.00", newTotal: "360.00" },
          },
        ]);
      });

      test("in yen, the warning's figures are whole yen", async () => {
        await useStore({ currency: "JPY", tax: HT });
        const { id, itemId, kayak } = await oldManualBooking({ currency: "JPY" });

        const result = await actions.updateReservation(id, { items: twoKayaks(itemId, kayak) });

        assert.deepEqual(result.warnings, [
          { key: "errors.editTaxAdded", params: { previousTotal: "150", newTotal: "360" } },
        ]);
      });

      test("in yen, a total that is its parts rounded once warns when the tax is added", async () => {
        await useStore({ currency: "JPY", tax: HT });
        // ¥100.40 + ¥0.40 of delivery, stored as ¥101: the sum rounded once.
        const { id, itemId, kayak } = await oldManualBooking({
          currency: "JPY",
          subtotalAmount: "100.40",
          deliveryFee: "0.40",
          totalAmount: "101.00",
        });

        const result = await actions.updateReservation(id, { items: twoKayaks(itemId, kayak) });

        assert.equal(result.error, undefined);
        assert.equal(result.warnings?.[0]?.key, "errors.editTaxAdded");
        assert.equal(result.warnings?.[0]?.params?.previousTotal, "101");
      });

      test("a row the engine totalled does not warn", async () => {
        await useStore({ tax: HT });
        const { id, itemId, kayak } = await oldManualBooking({ taxDisplayMode: "exclusive" });

        const result = await actions.updateReservation(id, { items: twoKayaks(itemId, kayak) });

        assert.equal(result.error, undefined);
        assert.equal(result.warnings, undefined);
      });

      test("taxes off: a line lowered under the discount does not warn", async () => {
        await useStore({ tax: { enabled: false, defaultRate: 20, displayMode: "exclusive" } });
        // 150 of rental, 100 of discount, 50 to pay; the line comes down to 40.
        const { id, itemId, kayak } = await oldManualBooking({
          discountAmount: "100.00",
          totalAmount: "50.00",
        });

        const result = await actions.updateReservation(id, {
          items: [
            {
              id: itemId,
              productId: kayak,
              quantity: 1,
              unitPrice: 20,
              depositPerUnit: 0,
              isManualPrice: true,
              pricingMode: "day",
              productSnapshot: { name: "Kayak" },
            },
          ],
        });

        assert.equal(result.error, undefined);
        assert.equal((await stored(id)).row.totalAmount, "0.00");
        assert.equal(result.warnings, undefined);
      });

      test("an older row whose total already carried its tax does not warn", async () => {
        await useStore({ tax: HT });
        // 150 before tax and 30 of tax, stored as a total of 180, no mode recorded.
        const { id, itemId, kayak } = await oldManualBooking({
          taxAmount: "30.00",
          totalAmount: "180.00",
        });

        const result = await actions.updateReservation(id, { items: twoKayaks(itemId, kayak) });

        assert.equal(result.error, undefined);
        assert.equal((await stored(id)).row.totalAmount, "360.00");
        assert.equal(result.warnings, undefined);
      });

      test("a line changed: the totals are the engine's, and the answer says the tax was added", async () => {
        await useStore({ tax: HT });
        const { id, itemId, kayak } = await oldManualBooking();

        const result = await actions.updateReservation(id, {
          items: [
            {
              id: itemId,
              productId: kayak,
              quantity: 2,
              unitPrice: 75,
              depositPerUnit: 0,
              isManualPrice: true,
              pricingMode: "day",
              productSnapshot: { name: "Kayak" },
            },
          ],
        });

        assert.equal(result.error, undefined);
        const { row } = await assertEngineTotals(id, HT);
        // Two at 75.00 a day for two days, 20 % on top.
        assert.equal(row.totalAmount, "360.00");
        assert.deepEqual(result.warnings, [
          {
            key: "errors.editTaxAdded",
            params: { previousTotal: "150.00", newTotal: "360.00" },
          },
        ]);
      });
    });

    describe("a creation by hand", () => {
      /** A reservation the store creates: a product line, a custom line, insurance. */
      async function created() {
        const taxed = await product();
        Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
        try {
          const result = await actions.createManualReservation({
            customerId: CUSTOMER,
            startDate: START,
            endDate: END,
            items: [{ productId: taxed, quantity: 2 }],
            customItems: [
              {
                name: "Cleaning",
                description: "",
                unitPrice: 5,
                quantity: 2,
                deposit: 0,
                pricingMode: "day",
              },
            ],
            discountAmount: 4,
            tulipInsuranceOptIn: true,
            sendConfirmationEmail: false,
          });
          assert.ok(result.reservationId, JSON.stringify(result));
          return result.reservationId;
        } finally {
          Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
        }
      }

      test("prices before tax: its totals are the engine's, the tax on top", async () => {
        await useStore({ tax: HT });
        const id = await created();

        const { row, items } = await assertEngineTotals(id, HT);
        // (40.00 + 20.00 - 4.00) before tax, 20 % on top, 12.50 of insurance with none.
        assert.deepEqual(
          [row.totalAmount, row.taxAmount, row.taxDisplayMode],
          ["79.70", "11.20", "exclusive"],
        );
        assert.deepEqual(
          Object.fromEntries(
            items.map((item) => [
              item.productSnapshot.name.startsWith("Kayak") ? "product" : item.productSnapshot.name,
              item.taxExempt,
            ]),
          ),
          { product: false, Cleaning: false, [INSURANCE_ITEM_NAME]: true },
        );
      });

      test("prices with tax: its total is what its prices add up to, the tax columns filled", async () => {
        await useStore({ tax: TTC });
        const id = await created();

        const { row } = await assertEngineTotals(id, TTC);
        assert.deepEqual([row.totalAmount, row.taxDisplayMode], ["68.50", "inclusive"]);
        assert.notEqual(row.taxAmount, null);
      });

      for (const [mode, expected] of [
        ["exclusive", { total: "244.00", tax: "22.00" }],
        ["inclusive", { total: "222.00", tax: "20.00" }],
      ] as const) {
        test(`in yen, prices ${mode} of tax at 10 %: whole yen, the lines' tax adding up`, async () => {
          await useStore({
            currency: "JPY",
            tax: { enabled: true, defaultRate: 10, displayMode: mode },
          });
          const taxed = await product();
          const result = await actions.createManualReservation({
            customerId: CUSTOMER,
            startDate: START,
            endDate: END,
            // 10 a day for two days, and ¥101 a day for two days typed by hand.
            items: [{ productId: taxed, quantity: 1 }],
            customItems: [
              {
                name: "Guide",
                description: "",
                unitPrice: 101,
                quantity: 1,
                deposit: 0,
                pricingMode: "day",
              },
            ],
            sendConfirmationEmail: false,
          });
          assert.ok(result.reservationId, JSON.stringify(result));

          const { row, items } = await stored(result.reservationId);
          assert.deepEqual([row.totalAmount, row.taxAmount], [expected.total, expected.tax]);
          const lineTax = items.reduce((sum, item) => sum + Number(item.taxAmount ?? 0), 0);
          assert.equal(lineTax.toFixed(2), row.taxAmount);
          for (const amount of [row.totalAmount, row.taxAmount, row.subtotalExclTax]) {
            assert.ok(Number.isInteger(Number(amount)), `${amount} is whole yen`);
          }
        });
      }

      /** What the form shows for one kayak over START–END at 10.00 a day, in `tax`. */
      const shown = (tax: TaxSettings | undefined, insuranceAmount = 0) =>
        creationTotals({
          productLines: [{ amount: 20, taxSettings: null }],
          customLines: [],
          insuranceAmount,
          deliveryFee: 0,
          discountAmount: 0,
          deposit: 0,
          taxSettings: tax,
          currency: "USD",
        }).total;

      async function reservationCount() {
        return (await louezDb.db.select({ id: louezDb.reservations.id }).from(louezDb.reservations))
          .length;
      }

      const createKayak = (
        kayak: string,
        expectedTotal: number,
        options: Partial<Parameters<typeof actions.createManualReservation>[0]> = {},
      ) =>
        actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: END,
          items: [{ productId: kayak, quantity: 1 }],
          sendConfirmationEmail: false,
          expectedTotal,
          ...options,
        });

      async function customerCount() {
        return (await louezDb.db.select({ id: louezDb.customers.id }).from(louezDb.customers))
          .length;
      }

      test("the insurer answers another premium than the form showed: refused, nothing written", async () => {
        await useStore({});
        const kayak = await product();
        // The form showed 20.00 of rental and 5.00 of insurance: 25.00.
        const confirmed = shown(undefined, 5);
        const before = await reservationCount();
        Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
        try {
          const result = await createKayak(kayak, confirmed, { tulipInsuranceOptIn: true });
          assert.deepEqual(result, {
            error: "errors.reservationChangedMeanwhile",
            shortfalls: [],
          });
        } finally {
          Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
        }
        assert.equal(await reservationCount(), before);
      });

      test("a total the form did not show: refused, nothing written", async () => {
        await useStore({});
        const kayak = await product();
        const before = await reservationCount();

        // As if the form had shown 500.00 of insurance: 520.00.
        const result = await createKayak(kayak, 520);

        assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile", shortfalls: [] });
        assert.equal(await reservationCount(), before);
      });

      test("a new customer and a stale total: no reservation, no customer", async () => {
        await useStore({ tax: HT });
        const kayak = await product();
        const before = { reservations: await reservationCount(), customers: await customerCount() };

        const result = await createKayak(kayak, shown(TTC), {
          customerId: undefined,
          newCustomer: { email: "new-renter@example.test", firstName: "New", lastName: "Renter" },
        });

        assert.deepEqual(result, { error: "errors.reservationChangedMeanwhile", shortfalls: [] });
        assert.deepEqual(
          { reservations: await reservationCount(), customers: await customerCount() },
          before,
        );
      });

      test("a customer of the same e-mail added by another screen meanwhile is the one booked", async () => {
        await useStore({ tax: HT });
        const kayak = await product();
        const email = "added-meanwhile@example.test";

        // Another transaction adds the customer without the store's lock, as
        // the checkout does, and commits once the creation waits on its row:
        // the creation has read before the row existed.
        const [result] = await raceOnOpenTransaction(
          database,
          async (holder) => {
            await holder.query(
              "INSERT INTO customers (id, store_id, email, first_name, last_name) VALUES (?, ?, ?, ?, ?)",
              ["cust_added_meanwhile", STORE, email, "Added", "Meanwhile"],
            );
          },
          [
            () =>
              createKayak(kayak, shown(HT), {
                customerId: undefined,
                newCustomer: { email, firstName: "Added", lastName: "Meanwhile" },
              }),
          ],
        );

        assert.ok(result?.reservationId, JSON.stringify(result));
        const [booked] = await louezDb.db
          .select({ customerId: louezDb.reservations.customerId })
          .from(louezDb.reservations)
          .where(eq(louezDb.reservations.id, result.reservationId));
        assert.equal(booked?.customerId, "cust_added_meanwhile");
      });

      test("two creations at once for one new customer: two reservations, one customer, no error", async () => {
        await useStore({ tax: HT });
        const [kayak, canoe] = [await product(), await product()];
        const email = "same-new-renter@example.test";
        const newCustomer = { email, firstName: "Same", lastName: "Renter" };

        // Another transaction holds the gap where the e-mail would go: each
        // creation reaches it with no customer of that e-mail, then waits.
        const results = await raceOnOpenTransaction(
          database,
          async (holder) => {
            await holder.query(
              "SELECT id FROM customers WHERE store_id = ? AND email = ? FOR UPDATE",
              [STORE, email],
            );
          },
          [kayak, canoe].map(
            (productId) => () =>
              createKayak(productId, shown(HT), { customerId: undefined, newCustomer }),
          ),
        );

        for (const result of results) assert.ok(result.reservationId, JSON.stringify(result));
        const booked = await louezDb.db
          .select({ customerId: louezDb.reservations.customerId })
          .from(louezDb.reservations)
          .where(
            inArray(
              louezDb.reservations.id,
              results.map((result) => result.reservationId ?? ""),
            ),
          );
        const customers = await louezDb.db
          .select({ id: louezDb.customers.id })
          .from(louezDb.customers)
          .where(eq(louezDb.customers.email, email));
        assert.equal(customers.length, 1);
        assert.deepEqual(
          booked.map((row) => row.customerId),
          [customers[0]?.id, customers[0]?.id],
        );
      });

      test("the total the form showed is the one written: accepted", async () => {
        await useStore({ tax: HT });
        const kayak = await product();

        const result = await createKayak(kayak, shown(HT));

        assert.ok(result.reservationId, JSON.stringify(result));
        const { row } = await stored(result.reservationId);
        assert.equal(row.totalAmount, "24.00");
      });

      for (const [change, apply] of [
        [
          "a catalogue price",
          async (kayak: string) => {
            await louezDb.db
              .update(louezDb.products)
              .set({ price: "20.00" })
              .where(eq(louezDb.products.id, kayak));
          },
        ],
        ["a tax rate", async () => useStore({ tax: { ...HT, defaultRate: 10 } })],
        ["the display mode", async () => useStore({ tax: TTC })],
      ] as const) {
        test(`${change} changed while the form was open: refused, nothing written`, async () => {
          await useStore({ tax: HT });
          const kayak = await product();
          // The form shows 24.00: 20.00 before tax, 20 % on top.
          const seen = shown(HT);
          await apply(kayak);
          const before = await reservationCount();

          await assert.rejects(
            createKayak(kayak, seen).then((result) => {
              throw new Error(result.error ?? "written");
            }),
            /errors\.reservationChangedMeanwhile/,
          );
          assert.equal(await reservationCount(), before);
        });
      }

      test("a product's price changed while the creation waited on its lock: refused, nothing written", async () => {
        await useStore({ tax: HT });
        const kayak = await product();
        const before = await reservationCount();

        const [result] = await raceOnOpenTransaction(
          database,
          async (holder) => {
            await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [kayak]);
            await holder.query("UPDATE products SET price = '20.00' WHERE id = ?", [kayak]);
          },
          [() => createKayak(kayak, shown(HT))],
        );

        assert.deepEqual(result, {
          error: "errors.reservationChangedMeanwhile",
          shortfalls: [],
        });
        assert.equal(await reservationCount(), before);
      });

      test("a line is rounded as the form rounds it: 3 at 0.015 is 0.05 on both sides", async () => {
        await useStore({});
        // A fixed price of 0.03, typed down by half to 0.015, three of them.
        const id = nextId("prd");
        await louezDb.db.insert(louezDb.products).values({
          id,
          storeId: STORE,
          name: "Peg",
          price: "0.03",
          pricingKind: "fixed",
          pricingMode: "day",
          quantity: 20,
        });
        const shownTotal = creationTotals({
          productLines: [{ amount: 0.015 * 3, taxSettings: null }],
          customLines: [],
          insuranceAmount: 0,
          deliveryFee: 0,
          discountAmount: 0,
          deposit: 0,
          taxSettings: undefined,
          currency: "USD",
        }).total;

        const result = await actions.createManualReservation({
          customerId: CUSTOMER,
          startDate: START,
          endDate: END,
          items: [{ productId: id, quantity: 3, priceOverride: { unitPrice: 0.015 } }],
          sendConfirmationEmail: false,
          expectedTotal: shownTotal,
        });

        assert.ok(result.reservationId, JSON.stringify(result));
        const { row, items } = await stored(result.reservationId);
        assert.equal(shownTotal, 0.05);
        assert.deepEqual([items[0]?.totalPrice, row.totalAmount], ["0.05", "0.05"]);
      });

      test("created, then edited with nothing changed: the same totals to the cent", async () => {
        await useStore({ tax: HT });
        const id = await created();
        const before = await stored(id);
        Reflect.set(globalThis, INSURANCE_QUOTE_KEY, 12.5);
        try {
          const result = await actions.updateReservation(id, {});
          assert.equal(result.error, undefined);
        } finally {
          Reflect.deleteProperty(globalThis, INSURANCE_QUOTE_KEY);
        }

        const after = await stored(id);
        const money = (row: typeof before.row) => [
          row.subtotalAmount,
          row.totalAmount,
          row.subtotalExclTax,
          row.taxAmount,
          row.taxRate,
          row.taxDisplayMode,
        ];
        assert.deepEqual(money(after.row), money(before.row));
        const lineMoney = (items: typeof before.items) =>
          items
            .map((item) => [
              item.productSnapshot.name,
              item.totalPrice,
              item.taxRate,
              item.taxAmount,
              item.totalExclTax,
            ])
            .sort();
        assert.deepEqual(lineMoney(after.items), lineMoney(before.items));
      });
    });
  },
);

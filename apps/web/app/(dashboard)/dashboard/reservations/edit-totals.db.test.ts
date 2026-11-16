import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";
import type { StoreSettings, TaxSettings } from "@louez/types";

import { STORE_KEY } from "./actions-test-stubs";

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

describe("the totals of an edit and of a creation by hand (database)", {
  skip: skipWithoutTestDatabase(),
}, () => {
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
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "owner_edit_totals", name: "Edit totals", slug: "edit-totals" });
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
      const fields = totalsEngine.getReservationItemTaxFields(expected, taxedLines[index]!, index);
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
});

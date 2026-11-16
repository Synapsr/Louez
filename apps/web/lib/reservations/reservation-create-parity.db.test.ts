import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { and, asc, eq, ne } from "drizzle-orm";

import {
  NOT_RECORDED,
  recordedPromotion,
  recordedTaxDisplayMode,
  recordedTaxExempt,
} from "@louez/api/services/pricing-facts";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The store's creation through the API (`createStoreReservation`,
// packages/api) prices a cart exactly as the online store's checkout
// (`createReservation`) prices the same cart: the same catalog, promotion,
// seasonal price and tax engine, the same totals, and the same pricing facts
// on each line. Both run here on one database, cart against cart, in a store
// that shows prices with tax and one that adds it on top, in two currencies.

// The checkout modules import Next.js-only guards and the file storage SDK.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only" || specifier === "@/lib/storage/files"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

const START = "2030-07-01T09:00:00.000Z";
const END = "2030-07-04T09:00:00.000Z";

const STORES = [
  {
    id: "parity_store_incl",
    currency: "EUR",
    tax: { enabled: true, defaultRate: 20, displayMode: "inclusive" as const },
  },
  {
    id: "parity_store_excl",
    currency: "USD",
    tax: { enabled: true, defaultRate: 10, displayMode: "exclusive" as const },
  },
];

/** A store of its own for the facts test, whose bookings the parity tests do not count. */
const FACTS_STORE = {
  id: "parity_store_facts",
  currency: "EUR",
  tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" as const },
};
// What each creator wrote for the facts test's cart before 0107: no amount
// changes. Per line, in the cart's order: unit price, total, tax rate, tax,
// price before tax, total before tax.
const FACTS_MONEY = {
  subtotal: "468.94",
  deposit: "520.00",
  total: "555.31",
  subtotalExclTax: "468.94",
  tax: "86.37",
  taxRate: "20.00",
};
const FACTS_LINES = [
  ["37.05", "74.10", "20.00", "14.82", "37.05", "74.10"],
  ["37.05", "37.05", "0.00", "0.00", "37.05", "37.05"],
  ["50.97", "152.92", "20.00", "30.58", "50.97", "152.92"],
  ["33.30", "33.30", "20.00", "6.66", "33.30", "33.30"],
  ["25.98", "51.97", "20.00", "10.39", "25.98", "51.97"],
  ["29.90", "119.60", "20.00", "23.92", "29.90", "119.60"],
];

describe(
  "an agent's creation prices as the checkout prices (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let checkout: typeof import("./create-reservation");
    let agent: typeof import("@louez/api/services/reservation-create");
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(8, "0")}`;

    before(async () => {
      database = await createTestDatabase("reservation_create_parity");
      louezDb = await import("@louez/db");
      checkout = await import("./create-reservation");
      // packages/api is ES modules: it needs the CommonJS packages' names by
      // hand. Loaded after the checkout, as the mocks change how later modules load.
      await import("@louez/mcp/testing/cjs-named-exports");
      agent = await import("@louez/api/services/reservation-create");
      for (const store of [...STORES, FACTS_STORE]) {
        await louezDb.db.insert(louezDb.stores).values({
          id: store.id,
          userId: "owner",
          name: store.id,
          slug: store.id.replaceAll("_", "-"),
          settings: {
            reservationMode: "request",
            currency: store.currency,
            advanceNoticeMinutes: 0,
            pendingBlocksAvailability: false,
            tax: store.tax,
          },
        });
      }
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** A cart of four lines: a plain one, a tax-exempt one, one on promotion, one at a seasonal price. */
    async function catalog(storeId: string) {
      const product = async (values: Partial<typeof louezDb.products.$inferInsert>) => {
        const id = nextId("parity_prd");
        await louezDb.db.insert(louezDb.products).values({
          id,
          storeId,
          name: `Product ${id}`,
          price: "12.35",
          deposit: "40.00",
          pricingMode: "day",
          quantity: 10,
          images: [`https://files.parity.test/${id}.png`],
          ...values,
        });
        return id;
      };
      const plain = await product({});
      const exempt = await product({ taxSettings: { inheritFromStore: false, customRate: 0 } });
      const promoted = await product({
        price: "19.99",
        promotion: { percentage: 15, startsOn: null, endsOn: null },
      });
      const seasonal = await product({ price: "8.00" });
      await louezDb.db.insert(louezDb.productSeasonalPricing).values({
        id: nextId("parity_sea"),
        productId: seasonal,
        name: "Summer",
        startDate: "2030-06-15",
        endDate: "2030-08-31",
        price: "11.10",
      });
      // Degressive by duration: 12.5 % off from three days.
      const tiered = await product({ price: "9.90" });
      await louezDb.db.insert(louezDb.productPricingTiers).values({
        id: nextId("parity_tie"),
        productId: tiered,
        minDuration: 3,
        discountPercent: "12.500000",
        displayOrder: 0,
      });
      // A rate-based product: 12.00 a day, or a package of 29.90 for three days.
      const rated = await product({ price: "12.00", basePeriodMinutes: 24 * 60 });
      await louezDb.db.insert(louezDb.productPricingTiers).values({
        id: nextId("parity_rat"),
        productId: rated,
        period: 3 * 24 * 60,
        price: "29.90",
        displayOrder: 0,
      });
      return [
        { productId: plain, quantity: 2 },
        { productId: exempt, quantity: 1 },
        { productId: promoted, quantity: 3 },
        { productId: seasonal, quantity: 1 },
        { productId: tiered, quantity: 2 },
        { productId: rated, quantity: 4 },
      ];
    }

    const PRICE_COLUMNS = [
      "subtotalAmount",
      "depositAmount",
      "totalAmount",
      "subtotalExclTax",
      "taxAmount",
      "taxRate",
      "discountAmount",
      "deliveryFee",
      "currency",
    ] as const;
    const LINE_COLUMNS = [
      "productId",
      "quantity",
      "unitPrice",
      "depositPerUnit",
      "totalPrice",
      "pricingBreakdown",
      "taxRate",
      "taxAmount",
      "priceExclTax",
      "totalExclTax",
    ] as const;

    /** A reservation's money and its lines' pricing facts, as stored. */
    async function stored(reservationId: string) {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      assert.ok(row);
      const items = await louezDb.db
        .select()
        .from(louezDb.reservationItems)
        .where(eq(louezDb.reservationItems.reservationId, reservationId))
        .orderBy(asc(louezDb.reservationItems.createdAt), asc(louezDb.reservationItems.id));
      const byProduct = new Map(items.map((item) => [item.productId, item]));
      return {
        money: Object.fromEntries(PRICE_COLUMNS.map((column) => [column, row[column]])),
        lines: [...byProduct.values()]
          .sort((a, b) => String(a.productId).localeCompare(String(b.productId)))
          .map(
            (item): Record<string, unknown> => ({
              ...Object.fromEntries(LINE_COLUMNS.map((column) => [column, item[column]])),
              snapshot: {
                name: item.productSnapshot?.name,
                images: item.productSnapshot?.images,
                description: item.productSnapshot?.description,
              },
            }),
          ),
      };
    }

    /** The same cart booked through the checkout and through the API's creation. */
    async function bookBoth(
      store: (typeof STORES)[number],
      lines: Awaited<ReturnType<typeof catalog>>,
    ) {
      const fromCheckout = await checkout.createReservation({
        source: "online",
        storeId: store.id,
        customer: {
          email: `buyer-${store.id}@parity.test`,
          firstName: "Ada",
          lastName: "Lovelace",
        },
        items: lines.map((line) => ({
          ...line,
          startDate: START,
          endDate: END,
          unitPrice: 0,
          depositPerUnit: 0,
        })),
        subtotalAmount: 0,
        depositAmount: 0,
        totalAmount: 0,
      });
      assert.ok(fromCheckout.ok, JSON.stringify(fromCheckout));

      const fromAgent = await agent.createStoreReservation(
        {
          storeId: store.id,
          userId: null,
          credential: { kind: "api_key", id: "parity_key" },
          transport: "openapi",
          store: { id: store.id, name: store.id, slug: store.id, ownerUserId: "owner" },
          ports: {
            afterCommit: () => {},
            runReservationEffects: async () => {},
            dispatchEffects: () => {},
          },
        },
        {
          customer: {
            email: `agent-${store.id}@parity.test`,
            firstName: "Ada",
            lastName: "Lovelace",
          },
          startDate: START,
          endDate: END,
          lines,
          status: "quote",
          notifyCustomer: false,
        },
      );
      return { fromCheckout, fromAgent };
    }

    for (const store of STORES) {
      test(`the same cart, the same money: ${store.currency}, prices ${store.tax.displayMode} of ${store.tax.defaultRate}% tax`, async () => {
        const lines = await catalog(store.id);

        const { fromCheckout, fromAgent } = await bookBoth(store, lines);

        const theirs = await stored(fromCheckout.reservationId);
        const ours = await stored(fromAgent.id);
        assert.deepEqual(ours.money, theirs.money);
        assert.deepEqual(ours.lines, theirs.lines);

        // The cart holds what each case is for: a promotion, a seasonal price, an exempt line, tax.
        const promotedLine = ours.lines.find((line) => line.productId === lines[2]?.productId);
        assert.ok(promotedLine?.pricingBreakdown, "the promotion's breakdown is stored");
        assert.equal(
          ours.lines.find((line) => line.productId === lines[1]?.productId)?.taxAmount,
          "0.00",
        );
        assert.equal(
          ours.lines.find((line) => line.productId === lines[3]?.productId)?.totalPrice,
          "33.30",
        );
        // Three days of 9.90, two of them, 12.5 % off; four packages of three days at 29.90.
        const total = (index: number) =>
          Number(ours.lines.find((line) => line.productId === lines[index]?.productId)?.totalPrice);
        assert.ok(total(4) < 9.9 * 3 * 2, "the duration tier applies");
        assert.notEqual(total(5), 12 * 3 * 4, "the period's rate applies");
        assert.notEqual(ours.money.taxAmount, null);
        assert.equal(ours.money.currency, store.currency);

        // Nothing else of the store was booked by either.
        const others = await louezDb.db
          .select({ id: louezDb.reservations.id })
          .from(louezDb.reservations)
          .where(
            and(
              eq(louezDb.reservations.storeId, store.id),
              ne(louezDb.reservations.id, fromCheckout.reservationId),
              ne(louezDb.reservations.id, fromAgent.id),
            ),
          );
        assert.deepEqual(others, []);
      });
    }

    test("each creator records the facts it priced with (slice 9); no amount changes", async () => {
      const lines = await catalog(FACTS_STORE.id);
      const { fromCheckout, fromAgent } = await bookBoth(FACTS_STORE, lines);

      for (const id of [fromCheckout.reservationId, fromAgent.id]) {
        const [row] = await louezDb.db
          .select()
          .from(louezDb.reservations)
          .where(eq(louezDb.reservations.id, id));
        assert.ok(row);
        const rows = await louezDb.db
          .select()
          .from(louezDb.reservationItems)
          .where(eq(louezDb.reservationItems.reservationId, id));
        const items = lines.map((line) => {
          const item = rows.find((candidate) => candidate.productId === line.productId);
          assert.ok(item, line.productId);
          return item;
        });

        assert.deepEqual(
          {
            subtotal: row.subtotalAmount,
            deposit: row.depositAmount,
            total: row.totalAmount,
            subtotalExclTax: row.subtotalExclTax,
            tax: row.taxAmount,
            taxRate: row.taxRate,
          },
          FACTS_MONEY,
          id,
        );
        assert.deepEqual(
          items.map((item) => [
            item.unitPrice,
            item.totalPrice,
            item.taxRate,
            item.taxAmount,
            item.priceExclTax,
            item.totalExclTax,
          ]),
          FACTS_LINES,
          id,
        );

        assert.equal(recordedTaxDisplayMode(row), "exclusive");
        assert.deepEqual(
          items.map(recordedTaxExempt),
          lines.map(() => false),
        );
        // The promoted line records its promotion; every other line records none.
        assert.deepEqual(
          items.map((item) => {
            const promotion = recordedPromotion(item);
            return promotion === NOT_RECORDED ? promotion : (promotion?.percentage ?? null);
          }),
          [null, null, 15, null, null, null],
        );
      }
    });
  },
);

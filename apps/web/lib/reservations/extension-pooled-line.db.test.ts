import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The extension's stock check reads a stored line as every writer stored it:
// a line with no combination (`combinationKey: null`) is served by any unit
// that matches what it chose, so a booking of two kayaks of any size, one M
// and one L free, extends; a line with its combination is checked on that
// combination alone, as before.

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

const STORE = "store_pooled_ext";
const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");

describe(
  "an extension of a line with no combination (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let extension: typeof import("./extension-quote");
    let product = "";
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    before(async () => {
      database = await createTestDatabase("pooled_extension");
      louezDb = await import("@louez/db");
      extension = await import("./extension-quote");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Pooled",
        slug: "pooled-extension",
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: true,
        },
      });
      // One M and one L, at 10.00 a day.
      product = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: product,
        storeId: STORE,
        name: "Kayak",
        price: "10.00",
        pricingMode: "day",
        trackUnits: true,
        bookingAttributeAxes: [{ key: "size", label: "Size", position: 0 }],
        quantity: 2,
      });
      for (const size of ["M", "L"]) {
        await louezDb.db.insert(louezDb.productUnits).values({
          id: nextId("unt"),
          productId: product,
          identifier: `Kayak ${size}`,
          attributes: { size },
          combinationKey: `size:${size}`,
        });
      }
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** A confirmed booking of one line, as a writer stored it. */
    async function booking(quantity: number, combinationKey: string | null) {
      const id = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer",
        number: id,
        status: "confirmed",
        startDate: START,
        endDate: END,
        subtotalAmount: "40.00",
        depositAmount: "0.00",
        totalAmount: "40.00",
        source: "manual",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("itm"),
        reservationId: id,
        productId: product,
        quantity,
        unitPrice: "20.00",
        depositPerUnit: "0.00",
        totalPrice: "40.00",
        combinationKey,
        selectedAttributes: combinationKey ? { size: combinationKey.slice("size:".length) } : null,
        productSnapshot: { name: "Kayak", description: null, images: [] },
      });
      return id;
    }

    /** The extension's stock check a day further, as `quoteExtension` runs it. */
    const extend = (reservationId: string) =>
      extension.runExtensionQuote({ storeId: STORE, reservationId }, (tx, reservation) =>
        extension.checkExtensionInventory(
          tx,
          reservation,
          new Date(END.getTime() + 24 * 3_600_000),
        ),
      );

    const cancel = (id: string) =>
      louezDb.db
        .update(louezDb.reservations)
        .set({ status: "cancelled" })
        .where(eq(louezDb.reservations.id, id));

    test("two of any size, one M and one L free: it extends", async () => {
      const id = await booking(2, null);
      try {
        await extend(id);
      } finally {
        await cancel(id);
      }
    });

    test("a line with its combination is checked on it alone, as before", async () => {
      const one = await booking(1, "size:M");
      try {
        await extend(one);
      } finally {
        await cancel(one);
      }
      const two = await booking(2, "size:M");
      try {
        await assert.rejects(extend(two), (error: unknown) => {
          assert.ok(error instanceof extension.ExtensionError);
          assert.equal(error.message, "unavailable");
          return true;
        });
      } finally {
        await cancel(two);
      }
    });
  },
);

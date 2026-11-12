import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// Required accessories are checked where a cart is composed: the checkout and
// the extension refuse a cart that lacks one. A confirmation confirms the
// lines as they are (status-change-races.db.test.ts).

// The checkout modules import Next.js-only guards and the file storage SDK.
// Plain Node is already a server, and these tests store no file.
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

const STORE = "store_accessories";
const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");

describe(
  "required accessories where a cart is composed (database)",
  {
    skip: skipWithoutTestDatabase(),
  },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let creation: typeof import("./create-reservation");
    let extension: typeof import("./extension-quote");
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("required_accessories");
      louezDb = await import("@louez/db");
      creation = await import("./create-reservation");
      extension = await import("./extension-quote");

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Accessories",
        slug: "required-accessories",
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: false,
        },
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    /** A bike that requires one helmet, both in stock. */
    async function bikeRequiringHelmet() {
      const product = async (name: string) => {
        const id = nextId("prd");
        await louezDb.db.insert(louezDb.products).values({
          id,
          storeId: STORE,
          name,
          price: "10.00",
          pricingMode: "day",
          quantity: 5,
        });
        return id;
      };
      const bike = await product("Bike");
      const helmet = await product("Helmet");
      await louezDb.db.insert(louezDb.productAccessories).values({
        id: nextId("acc"),
        productId: bike,
        accessoryId: helmet,
        required: true,
        quantity: 1,
      });
      return { bike, helmet };
    }

    const reservationsOfStore = () =>
      louezDb.db
        .select({ id: louezDb.reservations.id })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.storeId, STORE));

    test("the checkout refuses a cart without the required accessory, and writes nothing", async () => {
      const { bike, helmet } = await bikeRequiringHelmet();
      const before = (await reservationsOfStore()).length;

      const result = await creation.createReservation({
        source: "online",
        storeId: STORE,
        customer: { email: "ada@accessories.test", firstName: "Ada", lastName: "Lovelace" },
        items: [
          {
            productId: bike,
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

      assert.equal(result.ok, false);
      assert.ok(!result.ok);
      assert.equal(result.error, "errors.requiredAccessoriesMissing");
      assert.deepEqual(result.details, {
        code: "required_accessories_missing",
        missingAccessories: [
          {
            parentProductId: bike,
            accessoryProductId: helmet,
            requiredQuantity: 1,
            providedQuantity: 0,
          },
        ],
      });
      assert.equal((await reservationsOfStore()).length, before);
    });

    test("the extension refuses a booking without the required accessory, and passes one with it", async () => {
      const { bike, helmet } = await bikeRequiringHelmet();
      const booking = async (productIds: string[]) => {
        const id = nextId("res");
        // A fixture, so it may start in any status.
        await louezDb.db.insert(louezDb.reservations).values({
          id,
          storeId: STORE,
          customerId: "customer",
          number: id,
          status: "confirmed",
          startDate: START,
          endDate: END,
          subtotalAmount: "20.00",
          depositAmount: "0.00",
          totalAmount: "20.00",
          source: "online",
        });
        for (const productId of productIds) {
          await louezDb.db.insert(louezDb.reservationItems).values({
            id: nextId("itm"),
            reservationId: id,
            productId,
            quantity: 1,
            unitPrice: "10.00",
            depositPerUnit: "0.00",
            totalPrice: "20.00",
            productSnapshot: { name: productId, description: null, images: [] },
          });
        }
        return id;
      };
      // The extension's stock check, as `quoteExtension` runs it once priced.
      const extend = (reservationId: string) =>
        louezDb.db.transaction(async (tx) => {
          const reservation = await extension.loadExtensionReservation(tx, STORE, reservationId);
          await extension.checkExtensionInventory(
            tx,
            reservation,
            new Date(END.getTime() + 24 * 3_600_000),
          );
        });

      await assert.rejects(extend(await booking([bike])), (error: unknown) => {
        assert.ok(error instanceof extension.ExtensionError);
        // Not "unavailable", which tells the customer to pick another date.
        assert.equal(error.message, "manualRequired");
        return true;
      });
      await extend(await booking([bike, helmet]));
    });
  },
);

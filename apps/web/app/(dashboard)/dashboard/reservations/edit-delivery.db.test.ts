import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { count, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { STORE_KEY } from "./actions-test-stubs";

// The delivery legs of a reservation the store edits: a leg the edit sends to
// an address, or moves to another one, is priced from a place someone chose;
// without its coordinates the edit is refused before anything is written. A
// leg kept as stored is never asked again, and keeps the fee it was given. A
// reservation created by hand holds the same rule on both legs.

const STORE = "store_edit_legs";
const CUSTOMER = "customer_edit_legs";
const DAY = 86_400_000;
const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date(START.getTime() + 2 * DAY);
const STORE_POSITION = { latitude: "47.2125000", longitude: "-1.5592000" };
const DELIVERY = {
  enabled: true,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 0,
  maximumDistance: 100,
  freeDeliveryThreshold: null,
} as const;
/** A place chosen from the suggestions, about twelve kilometres from the store. */
const CARQUEFOU = {
  address: "24 Rue du Moulin, 44470 Carquefou",
  latitude: 47.2969,
  longitude: -1.4901,
};

describe("the delivery legs of an edit (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${++counter}`;
  let productId = "";

  before(async () => {
    // Distances are measured as the crow flies: no routing service is asked.
    delete process.env.GOOGLE_PLACES_API_KEY;
    database = await createTestDatabase("edit_delivery");
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    await import("@louez/mcp/testing/cjs-named-exports");

    const settings = { currency: "eur", delivery: DELIVERY };
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner_edit_legs",
      name: "Edit delivery",
      slug: "edit-delivery",
      ...STORE_POSITION,
      settings: settings as never,
    });
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      userId: "",
      name: "Edit delivery",
      slug: "edit-delivery",
      address: null,
      ...STORE_POSITION,
      settings,
      stripeAccountId: null,
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
    productId = nextId("prd");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId: STORE,
      name: "Bike",
      price: "10.00",
      pricingMode: "day",
      // Enough for every rental of the suite at once: only the delivery is under test.
      quantity: 100,
    });
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /**
   * A confirmed rental of 100.00 (five bikes, two days) delivered for 18.00
   * to an address, or to a text saved long ago without its coordinates, and
   * brought back to the store.
   */
  async function deliveredReservation(outbound: {
    address: string;
    latitude: string | null;
    longitude: string | null;
  }) {
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status: "confirmed",
      startDate: START,
      endDate: END,
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "118.00",
      deliveryFee: "18.00",
      discountAmount: "0.00",
      source: "manual",
      deliveryOption: "delivery",
      outboundMethod: "address",
      deliveryAddress: outbound.address,
      deliveryLatitude: outbound.latitude,
      deliveryLongitude: outbound.longitude,
      deliveryDistanceKm: outbound.latitude ? "12.00" : null,
      returnMethod: "store",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: id,
      productId,
      quantity: 5,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "100.00",
      productSnapshot: { name: "Bike", description: null, images: [] },
    });
    return id;
  }

  /** What the edit may write about the money and the legs. */
  async function legsOf(reservationId: string) {
    const r = louezDb.reservations;
    const [row] = await louezDb.db
      .select({
        endDate: r.endDate,
        subtotalAmount: r.subtotalAmount,
        totalAmount: r.totalAmount,
        deliveryFee: r.deliveryFee,
        outboundMethod: r.outboundMethod,
        deliveryAddress: r.deliveryAddress,
        deliveryLatitude: r.deliveryLatitude,
        deliveryLongitude: r.deliveryLongitude,
        deliveryDistanceKm: r.deliveryDistanceKm,
        returnMethod: r.returnMethod,
        returnAddress: r.returnAddress,
        returnLatitude: r.returnLatitude,
        returnLongitude: r.returnLongitude,
        updatedAt: r.updatedAt,
      })
      .from(r)
      .where(eq(r.id, reservationId));
    return row;
  }

  const PICKED = {
    address: "8 Quai de la Douane, 44000 Nantes",
    latitude: "47.2100000",
    longitude: "-1.5500000",
  };
  /** The outbound leg as the edit form sends it back untouched. */
  const keptOutbound = (stored: {
    address: string;
    latitude: string | null;
    longitude: string | null;
  }) => ({
    method: "address" as const,
    address: stored.address,
    city: "",
    postalCode: "",
    country: "FR",
    latitude: stored.latitude === null ? undefined : Number(stored.latitude),
    longitude: stored.longitude === null ? undefined : Number(stored.longitude),
  });
  const storeReturn = { method: "store" as const, locationId: null };

  test("a delivery address typed over a priced one, with no place chosen, is refused and nothing is written", async () => {
    const id = await deliveredReservation(PICKED);
    const before = await legsOf(id);

    const result = await actions.updateReservation(id, {
      delivery: {
        outbound: {
          method: "address",
          address: "8 quai de la douane nantes",
          city: "",
          postalCode: "",
          country: "FR",
        },
        return: storeReturn,
      },
    });

    assert.equal(result.error, "errors.deliveryAddressNotChosen");
    assert.deepEqual(await legsOf(id), before);
  });

  test("a collection address the edit adds without a place chosen is refused and nothing is written", async () => {
    const id = await deliveredReservation(PICKED);
    const before = await legsOf(id);

    const result = await actions.updateReservation(id, {
      delivery: {
        outbound: keptOutbound(PICKED),
        return: {
          method: "address",
          address: "12 rue de Siam",
          city: "",
          postalCode: "",
          country: "FR",
        },
      },
    });

    assert.equal(result.error, "errors.returnAddressNotChosen");
    assert.deepEqual(await legsOf(id), before);
  });

  test("a delivery address changed to a chosen place is saved and priced from it", async () => {
    const id = await deliveredReservation(PICKED);

    const result = await actions.updateReservation(id, {
      delivery: {
        outbound: {
          method: "address",
          address: CARQUEFOU.address,
          city: "Carquefou",
          postalCode: "44470",
          country: "FR",
          latitude: CARQUEFOU.latitude,
          longitude: CARQUEFOU.longitude,
        },
        return: storeReturn,
      },
    });

    assert.equal(result.error, undefined);
    const after = await legsOf(id);
    assert.equal(after?.deliveryAddress, CARQUEFOU.address);
    assert.equal(Number(after?.deliveryLatitude), CARQUEFOU.latitude);
    assert.equal(Number(after?.deliveryLongitude), CARQUEFOU.longitude);
    assert.ok(Number(after?.deliveryDistanceKm) > 0, "the leg is measured");
    assert.ok(Number(after?.deliveryFee) > 0, "the leg is priced");
    assert.equal(
      Number(after?.totalAmount),
      Number(after?.subtotalAmount) + Number(after?.deliveryFee),
    );
  });

  test("a delivery address saved long ago without a place does not block a change of dates, and keeps its fee", async () => {
    const legacy = { address: "Le Moulin, route de Nantes", latitude: null, longitude: null };
    const id = await deliveredReservation(legacy);
    const newEnd = new Date(END.getTime() + DAY);

    const result = await actions.updateReservation(id, {
      startDate: START,
      endDate: newEnd,
      delivery: { outbound: keptOutbound(legacy), return: storeReturn },
    });

    assert.equal(result.error, undefined);
    const after = await legsOf(id);
    assert.equal(after?.endDate.getTime(), newEnd.getTime());
    assert.equal(after?.deliveryFee, "18.00");
    assert.equal(after?.deliveryAddress, legacy.address);
    assert.equal(after?.deliveryLatitude, null);
    assert.equal(
      Number(after?.totalAmount),
      Number(after?.subtotalAmount) + 18,
      "the rental is repriced for its new window, the delivery is not",
    );
  });

  test("a delivery moved back to the store is saved without a fee", async () => {
    const id = await deliveredReservation(PICKED);

    const result = await actions.updateReservation(id, {
      delivery: { outbound: { method: "store", locationId: null }, return: storeReturn },
    });

    assert.equal(result.error, undefined);
    const after = await legsOf(id);
    assert.equal(after?.outboundMethod, "store");
    assert.equal(after?.deliveryAddress, null);
    assert.equal(after?.deliveryFee, "0.00");
    assert.equal(after?.totalAmount, "100.00");
  });

  for (const leg of ["outbound", "return"] as const) {
    test(`a reservation created by hand with a ${leg === "outbound" ? "delivery" : "collection"} address and no place chosen is refused and not written`, async () => {
      const reservationsOfStore = async () =>
        (
          await louezDb.db
            .select({ total: count() })
            .from(louezDb.reservations)
            .where(eq(louezDb.reservations.storeId, STORE))
        )[0]?.total;
      const before = await reservationsOfStore();
      const typed = { method: "address" as const, address: "12 rue de Siam", country: "FR" };
      const chosen = {
        method: "address" as const,
        address: CARQUEFOU.address,
        country: "FR",
        latitude: CARQUEFOU.latitude,
        longitude: CARQUEFOU.longitude,
      };

      const result = await actions.createManualReservation({
        customerId: CUSTOMER,
        startDate: START,
        endDate: END,
        items: [{ productId, quantity: 1 }],
        delivery:
          leg === "outbound"
            ? { outbound: typed, return: storeReturn }
            : { outbound: chosen, return: typed },
        sendConfirmationEmail: false,
      });

      assert.equal(
        result.error,
        leg === "outbound" ? "errors.deliveryAddressRequired" : "errors.returnAddressRequired",
      );
      assert.equal(await reservationsOfStore(), before);
    });
  }
});

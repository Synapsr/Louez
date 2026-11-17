import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { count, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { calculateTotalDeliveryFee } from "@/lib/utils/geo";

import { STORE_KEY } from "./actions-test-stubs";

// The delivery legs of a reservation the store edits. The edit saves no
// address leg without its place, changed or not: such a leg has no distance,
// and any save would price it at zero. It is refused before anything is
// written, and goes through once the address is chosen or the leg goes back
// to the store. Legs that all have their place are priced as they always
// were: from the route to each, the store's tariff and the rental's amount.
// A reservation created by hand holds the same rule on both legs.

const STORE = "store_edit_legs";
const CUSTOMER = "customer_edit_legs";
const DAY = 86_400_000;
const START = new Date("2031-06-10T09:00:00.000Z");
const TWO_DAYS = new Date(START.getTime() + 2 * DAY);
const THREE_DAYS = new Date(START.getTime() + 3 * DAY);
const STORE_POSITION = { latitude: 47.2125, longitude: -1.5592 };
/** Free from 125.00 of rental: two days of five bikes (100.00) pay, three (150.00) do not. */
const DELIVERY = {
  enabled: true,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 0,
  maximumDistance: 100,
  freeDeliveryThreshold: 125,
} as const;

interface Place {
  address: string;
  latitude: number;
  longitude: number;
}
/** Places chosen from the suggestions, a few kilometres from the store. */
const CARQUEFOU: Place = {
  address: "24 Rue du Moulin, 44470 Carquefou",
  latitude: 47.2969,
  longitude: -1.4901,
};
const REZE: Place = {
  address: "3 Rue Jean Jaurès, 44400 Rezé",
  latitude: 47.1833,
  longitude: -1.55,
};

/** A leg as a reservation stores it: at the store, or at an address with or without its place. */
type StoredLeg =
  | { method: "store" }
  | { method: "address"; address: string; latitude: number | null; longitude: number | null };

describe("the delivery legs of an edit (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let services: typeof import("@louez/api/services");
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
    services = await import("@louez/api/services");

    const settings = { currency: "eur", delivery: DELIVERY };
    const position = {
      latitude: STORE_POSITION.latitude.toFixed(7),
      longitude: STORE_POSITION.longitude.toFixed(7),
    };
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner_edit_legs",
      name: "Edit delivery",
      slug: "edit-delivery",
      ...position,
      settings: settings as never,
    });
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      userId: "",
      name: "Edit delivery",
      slug: "edit-delivery",
      address: null,
      ...position,
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

  /** A confirmed rental of five bikes at 10.00 a day, with its legs and the fee they were given. */
  async function reservation({
    outbound,
    back = { method: "store" },
    end = TWO_DAYS,
    deliveryFee,
    country = null,
  }: {
    outbound: StoredLeg;
    back?: StoredLeg;
    end?: Date;
    deliveryFee: number;
    /** The country stored with each address leg: none on rows written before it was kept. */
    country?: string | null;
  }) {
    const id = nextId("res");
    const itemId = nextId("itm");
    const days = Math.round((end.getTime() - START.getTime()) / DAY);
    const subtotal = 5 * 10 * days;
    const coordinate = (value: number | null) => (value === null ? null : value.toFixed(7));
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status: "confirmed",
      startDate: START,
      endDate: end,
      subtotalAmount: subtotal.toFixed(2),
      depositAmount: "0.00",
      totalAmount: (subtotal + deliveryFee).toFixed(2),
      deliveryFee: deliveryFee.toFixed(2),
      discountAmount: "0.00",
      source: "manual",
      deliveryOption:
        outbound.method === "address" || back.method === "address" ? "delivery" : "pickup",
      outboundMethod: outbound.method,
      ...(outbound.method === "address"
        ? {
            deliveryAddress: outbound.address,
            deliveryCountry: country,
            deliveryLatitude: coordinate(outbound.latitude),
            deliveryLongitude: coordinate(outbound.longitude),
          }
        : {}),
      returnMethod: back.method,
      ...(back.method === "address"
        ? {
            returnAddress: back.address,
            returnCountry: country,
            returnLatitude: coordinate(back.latitude),
            returnLongitude: coordinate(back.longitude),
          }
        : {}),
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId: id,
      productId,
      quantity: 5,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: subtotal.toFixed(2),
      productSnapshot: { name: "Bike", description: null, images: [] },
    });
    return { id, itemId };
  }

  /** A leg as the edit form sends it: what it holds, a country of "FR" where the row has none. */
  const sent = (leg: StoredLeg) =>
    leg.method === "store"
      ? { method: "store" as const, locationId: null }
      : {
          method: "address" as const,
          address: leg.address,
          city: "",
          postalCode: "",
          country: "FR",
          latitude: leg.latitude ?? undefined,
          longitude: leg.longitude ?? undefined,
        };
  const atStore: StoredLeg = { method: "store" };
  const at = (place: Place): StoredLeg => ({ method: "address", ...place });
  const typed = (address: string): StoredLeg => ({
    method: "address",
    address,
    latitude: null,
    longitude: null,
  });

  /** What the edit may write about the window, the money and the legs. */
  async function rowOf(reservationId: string) {
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
    const i = louezDb.reservationItems;
    const items = await louezDb.db
      .select({ quantity: i.quantity, totalPrice: i.totalPrice })
      .from(i)
      .where(eq(i.reservationId, reservationId));
    return { row, items };
  }

  /** The fee the store's tariff gives these legs for this rental, measured as the edit measures them. */
  async function tariff(legs: Array<Place | null>, rental: number) {
    const [outbound, back] = await Promise.all(
      legs.map(async (place) =>
        place
          ? (
              await services.getRouteDistance({
                originLatitude: STORE_POSITION.latitude,
                originLongitude: STORE_POSITION.longitude,
                destinationLatitude: place.latitude,
                destinationLongitude: place.longitude,
              })
            ).distanceKm
          : null,
      ),
    );
    return calculateTotalDeliveryFee(outbound ?? null, back ?? null, DELIVERY, rental).totalFee;
  }

  test("a delivery address typed over a priced one, with no place chosen, is refused and nothing is written", async () => {
    const booking = await reservation({ outbound: at(CARQUEFOU), deliveryFee: 16 });
    const before = await rowOf(booking.id);

    const result = await actions.updateReservation(booking.id, {
      delivery: { outbound: sent(typed("8 quai de la douane nantes")), return: sent(atStore) },
    });

    assert.equal(result.error, "errors.deliveryAddressNotChosen");
    assert.deepEqual(await rowOf(booking.id), before);
  });

  test("a collection address the edit adds without a place chosen is refused and nothing is written", async () => {
    const booking = await reservation({ outbound: at(CARQUEFOU), deliveryFee: 16 });
    const before = await rowOf(booking.id);

    const result = await actions.updateReservation(booking.id, {
      delivery: { outbound: sent(at(CARQUEFOU)), return: sent(typed("12 rue de Siam")) },
    });

    assert.equal(result.error, "errors.returnAddressNotChosen");
    assert.deepEqual(await rowOf(booking.id), before);
  });

  for (const [edit, change] of [
    ["the dates", { startDate: START, endDate: THREE_DAYS }],
    ["a quantity", { items: "quantity" }],
  ] as const) {
    test(`a stored delivery address without its place refuses an edit of ${edit}, and nothing is written`, async () => {
      const legacy = typed("Le Moulin, route de Nantes");
      const booking = await reservation({ outbound: legacy, deliveryFee: 18 });
      const before = await rowOf(booking.id);

      const result = await actions.updateReservation(booking.id, {
        ...("items" in change
          ? {
              items: [
                {
                  id: booking.itemId,
                  productId,
                  quantity: 6,
                  unitPrice: 10,
                  depositPerUnit: 0,
                  productSnapshot: { name: "Bike" },
                },
              ],
            }
          : change),
        delivery: { outbound: sent(legacy), return: sent(atStore) },
      });

      assert.equal(result.error, "errors.deliveryAddressNotChosen");
      assert.deepEqual(await rowOf(booking.id), before);
    });
  }

  test("the same edit of the dates goes through once the address is chosen, priced from it", async () => {
    const booking = await reservation({ outbound: typed("Le Moulin"), deliveryFee: 18 });

    const result = await actions.updateReservation(booking.id, {
      startDate: START,
      endDate: TWO_DAYS,
      delivery: { outbound: sent(at(CARQUEFOU)), return: sent(atStore) },
    });

    assert.equal(result.error, undefined);
    const { row } = await rowOf(booking.id);
    assert.equal(Number(row?.deliveryLatitude), CARQUEFOU.latitude);
    assert.equal(Number(row?.deliveryFee), await tariff([CARQUEFOU, null], 100));
    assert.ok(Number(row?.deliveryFee) > 0);
    assert.equal(Number(row?.totalAmount), 100 + Number(row?.deliveryFee));
  });

  test("the same edit of the dates goes through once the leg goes back to the store, with no fee", async () => {
    const booking = await reservation({ outbound: typed("Le Moulin"), deliveryFee: 18 });

    const result = await actions.updateReservation(booking.id, {
      startDate: START,
      endDate: THREE_DAYS,
      delivery: { outbound: sent(atStore), return: sent(atStore) },
    });

    assert.equal(result.error, undefined);
    const { row } = await rowOf(booking.id);
    assert.equal(row?.outboundMethod, "store");
    assert.equal(row?.deliveryAddress, null);
    assert.equal(row?.deliveryFee, "0.00");
    assert.equal(row?.totalAmount, "150.00");
  });

  test("a reservation with one leg located and one stored without its place refuses any edit", async () => {
    const booking = await reservation({
      outbound: typed("Le Moulin"),
      back: at(REZE),
      deliveryFee: 30,
    });
    const before = await rowOf(booking.id);

    const result = await actions.updateReservation(booking.id, {
      startDate: START,
      endDate: THREE_DAYS,
      delivery: { outbound: sent(typed("Le Moulin")), return: sent(at(REZE)) },
    });

    assert.equal(result.error, "errors.deliveryAddressNotChosen");
    assert.deepEqual(await rowOf(booking.id), before);
  });

  test("a chosen collection added to a delivery stored without its place is refused, and nothing is written", async () => {
    const legacy = typed("Le Moulin");
    const booking = await reservation({ outbound: legacy, deliveryFee: 18 });
    const before = await rowOf(booking.id);

    const result = await actions.updateReservation(booking.id, {
      delivery: { outbound: sent(legacy), return: sent(at(REZE)) },
    });

    assert.equal(result.error, "errors.deliveryAddressNotChosen");
    assert.deepEqual(await rowOf(booking.id), before);
  });

  test("with delivery included, an edit of located legs saves no fee, as the form shows", async () => {
    const included = { currency: "eur", delivery: { ...DELIVERY, mode: "included" } };
    const store = Reflect.get(globalThis, STORE_KEY) as Record<string, unknown>;
    const useSettings = async (settings: unknown) => {
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: settings as never })
        .where(eq(louezDb.stores.id, STORE));
      Reflect.set(globalThis, STORE_KEY, { ...store, settings });
    };
    await useSettings(included);
    try {
      const booking = await reservation({ outbound: at(CARQUEFOU), deliveryFee: 18 });

      const result = await actions.updateReservation(booking.id, {
        startDate: START,
        endDate: THREE_DAYS,
        delivery: { outbound: sent(at(CARQUEFOU)), return: sent(atStore) },
      });

      assert.equal(result.error, undefined);
      const { row } = await rowOf(booking.id);
      assert.equal(row?.deliveryFee, "0.00");
      assert.equal(row?.totalAmount, "150.00");
    } finally {
      await useSettings(store.settings);
    }
  });

  test("located legs crossing below the free-delivery amount are priced by the tariff", async () => {
    const booking = await reservation({
      outbound: at(CARQUEFOU),
      back: at(REZE),
      end: THREE_DAYS,
      deliveryFee: 0,
    });

    const result = await actions.updateReservation(booking.id, {
      startDate: START,
      endDate: TWO_DAYS,
      delivery: { outbound: sent(at(CARQUEFOU)), return: sent(at(REZE)) },
    });

    assert.equal(result.error, undefined);
    const { row } = await rowOf(booking.id);
    const fee = await tariff([CARQUEFOU, REZE], 100);
    assert.ok(fee > 0);
    assert.equal(Number(row?.deliveryFee), fee);
    assert.equal(Number(row?.totalAmount), Math.round((100 + fee) * 100) / 100);
  });

  test("located legs crossing above the free-delivery amount become free", async () => {
    const booking = await reservation({
      outbound: at(CARQUEFOU),
      back: at(REZE),
      end: TWO_DAYS,
      deliveryFee: 36,
    });

    const result = await actions.updateReservation(booking.id, {
      startDate: START,
      endDate: THREE_DAYS,
      delivery: { outbound: sent(at(CARQUEFOU)), return: sent(at(REZE)) },
    });

    assert.equal(result.error, undefined);
    const { row } = await rowOf(booking.id);
    assert.equal(row?.deliveryFee, "0.00");
    assert.equal(row?.totalAmount, "150.00");
  });

  test("an edit of a quantity that touches nothing of the located delivery is priced by the tariff", async () => {
    const booking = await reservation({ outbound: at(CARQUEFOU), deliveryFee: 16 });

    const result = await actions.updateReservation(booking.id, {
      items: [
        {
          id: booking.itemId,
          productId,
          quantity: 4,
          unitPrice: 10,
          depositPerUnit: 0,
          productSnapshot: { name: "Bike" },
        },
      ],
      delivery: { outbound: sent(at(CARQUEFOU)), return: sent(atStore) },
    });

    assert.equal(result.error, undefined);
    const { row, items } = await rowOf(booking.id);
    assert.equal(items[0]?.quantity, 4);
    assert.equal(Number(row?.deliveryFee), await tariff([CARQUEFOU, null], 80));
  });

  test("a located address stored without its country, city or postal code edits with no error", async () => {
    const booking = await reservation({ outbound: at(CARQUEFOU), deliveryFee: 16, country: null });

    const result = await actions.updateReservation(booking.id, {
      startDate: START,
      endDate: TWO_DAYS,
      delivery: { outbound: sent(at(CARQUEFOU)), return: sent(atStore) },
    });

    assert.equal(result.error, undefined);
    const { row } = await rowOf(booking.id);
    assert.equal(Number(row?.deliveryFee), await tariff([CARQUEFOU, null], 100));
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
      const unchosen = { method: "address" as const, address: "12 rue de Siam", country: "FR" };

      const result = await actions.createManualReservation({
        customerId: CUSTOMER,
        startDate: START,
        endDate: TWO_DAYS,
        items: [{ productId, quantity: 1 }],
        delivery:
          leg === "outbound"
            ? { outbound: unchosen, return: sent(atStore) }
            : { outbound: sent(at(CARQUEFOU)), return: unchosen },
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

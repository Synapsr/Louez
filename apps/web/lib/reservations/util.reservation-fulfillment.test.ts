import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveReservationFulfillment } from "./util.reservation-fulfillment";

const store = { name: "Loueur", address: "1 quai du Port, 29200 Brest" };

const snapshot = (name: string, address: string, city: string, postalCode: string) => ({
  type: "additional" as const,
  name,
  address,
  city,
  postalCode,
  country: "FR",
});

describe("resolveReservationFulfillment", () => {
  test("both legs at the same store location", () => {
    const port = snapshot("Boutique du Port", "1 quai du Port", "Brest", "29200");
    const { pickup, dropoff, isSamePlace } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "store",
        returnMethod: "store",
        pickupLocationSnapshot: port,
        returnLocationSnapshot: port,
      },
      store,
    });

    assert.deepEqual(pickup, {
      kind: "store",
      name: "Boutique du Port",
      address: "1 quai du Port, 29200 Brest",
    });
    assert.deepEqual(dropoff, pickup);
    assert.equal(isSamePlace, true);
  });

  test("collected at one location, returned to another", () => {
    const { pickup, dropoff, isSamePlace } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "store",
        returnMethod: "store",
        pickupLocationSnapshot: snapshot("Boutique du Port", "1 quai du Port", "Brest", "29200"),
        returnLocationSnapshot: snapshot("Annexe Gare", "3 place de la Gare", "Brest", "29200"),
      },
      store,
    });

    assert.equal(pickup.name, "Boutique du Port");
    assert.equal(dropoff.name, "Annexe Gare");
    assert.equal(dropoff.address, "3 place de la Gare, 29200 Brest");
    assert.equal(isSamePlace, false);
  });

  test("a return leg without its own location goes back to the pickup one", () => {
    const { dropoff, isSamePlace } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "store",
        returnMethod: "store",
        pickupLocationSnapshot: snapshot("Boutique du Port", "1 quai du Port", "Brest", "29200"),
        returnLocationSnapshot: null,
      },
      store,
    });

    assert.equal(dropoff.name, "Boutique du Port");
    assert.equal(isSamePlace, true);
  });

  test("no snapshot at all falls back to the store itself", () => {
    const { pickup } = resolveReservationFulfillment({
      reservation: { outboundMethod: "store", returnMethod: "store" },
      store,
    });

    assert.deepEqual(pickup, { kind: "store", name: "Loueur", address: store.address });
  });

  test("delivered and collected back at the customer's address", () => {
    const { pickup, dropoff, isSamePlace } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "address",
        returnMethod: "address",
        deliveryAddress: "10 rue de la Paix",
        deliveryCity: "Paris",
        deliveryPostalCode: "75002",
        returnAddress: "10 rue de la Paix",
        returnCity: "Paris",
        returnPostalCode: "75002",
      },
      store,
    });

    assert.deepEqual(pickup, {
      kind: "address",
      name: null,
      address: "10 rue de la Paix, 75002 Paris",
    });
    assert.deepEqual(dropoff, pickup);
    assert.equal(isSamePlace, true);
  });

  test("delivered to the customer, brought back to the store", () => {
    const { pickup, dropoff, isSamePlace } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "address",
        returnMethod: "store",
        deliveryAddress: "10 rue de la Paix",
        deliveryCity: "Paris",
        deliveryPostalCode: "75002",
        returnLocationSnapshot: snapshot("Boutique du Port", "1 quai du Port", "Brest", "29200"),
      },
      store,
    });

    assert.equal(pickup.kind, "address");
    assert.equal(dropoff.kind, "store");
    assert.equal(dropoff.name, "Boutique du Port");
    assert.equal(isSamePlace, false);
  });

  test("a collection without its own address reuses the delivery one", () => {
    const { dropoff } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "address",
        returnMethod: "address",
        deliveryAddress: "10 rue de la Paix",
        deliveryCity: "Paris",
        deliveryPostalCode: "75002",
      },
      store,
    });

    assert.equal(dropoff.address, "10 rue de la Paix, 75002 Paris");
  });

  test("a legacy delivery row still reads as an outbound address leg", () => {
    const { pickup, dropoff } = resolveReservationFulfillment({
      reservation: {
        outboundMethod: "store",
        returnMethod: "store",
        deliveryOption: "delivery",
        deliveryAddress: "10 rue de la Paix",
        deliveryCity: "Paris",
        deliveryPostalCode: "75002",
      },
      store,
    });

    assert.equal(pickup.kind, "address");
    assert.equal(pickup.address, "10 rue de la Paix, 75002 Paris");
    assert.equal(dropoff.kind, "store");
  });
});

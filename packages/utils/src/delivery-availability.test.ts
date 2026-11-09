import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeliverySettings } from "@louez/types";

import { getDeliveryAvailability, hasUsableStoreCoordinates } from "./delivery-availability";

const settings = (overrides: Partial<DeliverySettings> = {}): DeliverySettings => ({
  enabled: true,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 10,
  maximumDistance: null,
  freeDeliveryThreshold: null,
  ...overrides,
});
const BREST = { latitude: "48.3904000", longitude: "-4.4861000" };
const NOWHERE = { latitude: null, longitude: null };

test("address delivery needs delivery on and coordinates on the map", () => {
  assert.equal(getDeliveryAvailability(settings(), BREST).addressDelivery, true);
  assert.equal(getDeliveryAvailability(settings(), NOWHERE).addressDelivery, false);
  assert.equal(getDeliveryAvailability(settings({ enabled: false }), BREST).addressDelivery, false);
  assert.equal(getDeliveryAvailability(undefined, BREST).addressDelivery, false);
  // Checkout gets numbers, the server strings: both read the same.
  assert.equal(
    getDeliveryAvailability(settings(), { latitude: 48.39, longitude: -4.48 }).addressDelivery,
    true,
  );
});

test("a delivery-only mode refuses a pickup while delivery is on, coordinates or not", () => {
  for (const mode of ["required", "included"] as const) {
    assert.equal(getDeliveryAvailability(settings({ mode }), NOWHERE).deliveryOnly, true);
    assert.equal(getDeliveryAvailability(settings({ mode }), BREST).deliveryOnly, true);
    assert.equal(
      getDeliveryAvailability(settings({ mode, enabled: false }), BREST).deliveryOnly,
      false,
    );
  }
  assert.equal(getDeliveryAvailability(settings(), BREST).deliveryOnly, false);
  assert.equal(
    getDeliveryAvailability(settings({ mode: "included" }), BREST).deliveryIncluded,
    true,
  );
});

test("coordinates: set, numeric and in range", () => {
  assert.equal(hasUsableStoreCoordinates("48.39", "-4.48"), true);
  assert.equal(hasUsableStoreCoordinates("", "-4.48"), false);
  assert.equal(hasUsableStoreCoordinates("abc", "-4.48"), false);
  assert.equal(hasUsableStoreCoordinates("123", "-4.48"), false);
  assert.equal(hasUsableStoreCoordinates(48.39, 181), false);
  assert.equal(hasUsableStoreCoordinates(0, 0), true);
});

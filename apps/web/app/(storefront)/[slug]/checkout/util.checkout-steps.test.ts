import assert from "node:assert/strict";
import { test } from "node:test";

import { getCheckoutStepIds, getStepForErrorKey } from "./util.checkout-steps";

test("the details step sits between contact and delivery, only when asked", () => {
  assert.deepEqual(getCheckoutStepIds({ isDeliveryEnabled: false }), ["contact", "confirm"]);
  assert.deepEqual(getCheckoutStepIds({ isDeliveryEnabled: true, hasDetailsStep: true }), [
    "contact",
    "details",
    "delivery",
    "confirm",
  ]);
  assert.deepEqual(getCheckoutStepIds({ isDeliveryEnabled: false, hasDetailsStep: true }), [
    "contact",
    "details",
    "confirm",
  ]);
});

test("a custom field error points at the contact step", () => {
  assert.equal(getStepForErrorKey("errors.customFieldRequired", true), "contact");
  assert.equal(getStepForErrorKey("errors.customFieldInvalid", false, true), "contact");
});

test("a native profile field error (birth date, source, links) points at the contact step", () => {
  assert.equal(getStepForErrorKey("errors.profileFieldRequired", true, true), "contact");
  assert.equal(getStepForErrorKey("errors.profileFieldInvalid", false), "contact");
});

test("an item detail error points at the details step when the checkout has one", () => {
  assert.equal(getStepForErrorKey("errors.itemDetailRequired", true, true), "details");
  assert.equal(getStepForErrorKey("errors.itemDetailInvalid", false, true), "details");
  assert.equal(getStepForErrorKey("errors.itemDetailRequired", true), "confirm");
});

test("existing keys keep their step", () => {
  assert.equal(getStepForErrorKey("errors.deliveryAddressRequired", true), "delivery");
  assert.equal(getStepForErrorKey("errors.invalidPhone", true), "contact");
  assert.equal(getStepForErrorKey("errors.productNotFound", true, true), "confirm");
});

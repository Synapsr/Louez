import assert from "node:assert/strict";
import { test } from "node:test";

import { CUSTOMER_FIELD_TEMPLATES } from "@/lib/customers/customer-field-templates";

import { straightLineDistanceKm } from "./demo-addresses";
import { DEMO_EMAIL_DOMAIN, DEMO_VISITOR_CUSTOMER } from "./people";
import { DEMO_VERTICAL_KEYS, DEMO_VERTICALS } from "./verticals";

// Every demo trade is coherent (its baskets, accessories and featured product exist),
// and holds no way to reach a real person: e-mails in the reserved `.example` domain,
// phone numbers in the ARCEP fiction ranges.

const FICTION_PHONE = /^0(1 99 00|2 61 91|3 53 48|4 65 71|5 36 49|6 39 98)\b/;

for (const key of DEMO_VERTICAL_KEYS) {
  const vertical = DEMO_VERTICALS[key];

  test(`${key}: baskets, accessories and the featured product name real products`, () => {
    const keys = new Set(vertical.products.map((product) => product.key));
    assert.equal(keys.size, vertical.products.length, "product keys are unique");
    assert.ok(keys.has(vertical.featuredProductKey), vertical.featuredProductKey);
    assert.ok(vertical.baskets.length > 0);
    for (const basket of vertical.baskets) {
      assert.ok(basket.lines.length > 0);
      for (const line of basket.lines) assert.ok(keys.has(line.key), line.key);
    }
    for (const product of vertical.products) {
      for (const accessory of product.accessories ?? []) {
        if (key === "velo") continue; // The bike catalog's accessories are filtered at seed time.
        assert.ok(keys.has(accessory), `${product.key} → ${accessory}`);
      }
      const categories = new Set(vertical.categories.map((category) => category.name));
      assert.ok(categories.has(product.category), `${product.key}: ${product.category}`);
      assert.ok(product.images.length > 0, `${product.key} has a photo`);
      if (product.trackUnits) {
        assert.ok(
          (product.units ?? []).reduce((sum, unit) => sum + unit.count, 0) > 0,
          product.key,
        );
      }
    }
    assert.equal(vertical.monthWeights.length, 12);
    assert.ok(vertical.guide.some((step) => step.key === "book"));
  });

  test(`${key}: two scenarios, per-unit fields and addresses that hold together`, () => {
    const keys = new Set(vertical.products.map((product) => product.key));
    assert.deepEqual(
      vertical.scenarios.map((scenario) => scenario.key),
      ["simple", "trade"],
    );
    for (const scenario of vertical.scenarios) {
      assert.ok(keys.has(scenario.productKey), scenario.productKey);
      assert.ok(scenario.steps.length > 0 && scenario.steps.length <= 3, scenario.key);
    }
    for (const field of vertical.itemFields) {
      assert.ok(field.productKeys.length > 0, field.key);
      for (const product of field.productKeys) assert.ok(keys.has(product), product);
      // The very fields of the Louez template a shop of the trade would adopt.
      const template = CUSTOMER_FIELD_TEMPLATES.find((entry) => entry.id === field.templateKey);
      assert.ok(
        template?.fields.some((entry) => entry.key === field.key),
        field.key,
      );
    }
    // The trade case of a trade that asks per unit asks it for the scenario's product.
    if (vertical.itemFields.length > 0) {
      const trade = vertical.scenarios[1];
      assert.ok(vertical.itemFields.some((field) => field.productKeys.includes(trade.productKey)));
    }
    for (const address of vertical.deliveryAddresses) {
      const km = straightLineDistanceKm({
        originLatitude: Number(vertical.store.latitude),
        originLongitude: Number(vertical.store.longitude),
        destinationLatitude: address.latitude,
        destinationLongitude: address.longitude,
      });
      assert.ok(km < 30, `${address.formattedAddress}: ${km} km`);
    }
  });

  test(`${key}: no contact detail can reach anyone`, () => {
    assert.match(vertical.store.email, /\.example$/);
    assert.match(vertical.store.phone, FICTION_PHONE);
  });
}

test("the demo's customers and its visitor are invented and unreachable", () => {
  assert.equal(DEMO_EMAIL_DOMAIN.endsWith(".example"), true);
  assert.match(DEMO_VISITOR_CUSTOMER.phone, FICTION_PHONE);
});

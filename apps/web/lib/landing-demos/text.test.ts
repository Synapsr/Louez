import assert from "node:assert/strict";
import test from "node:test";
import { locales } from "@/i18n/config";
import { DEMO_CATEGORIES, DEMO_PRODUCTS, getDemoCategories, getDemoProducts } from "./fixtures";
import { getDemoLocale, getDemoText } from "./text";

test("every language names every demo product and category", () => {
  for (const locale of locales) {
    const text = getDemoText(locale);
    for (const product of DEMO_PRODUCTS)
      assert.ok(text.products[product.id], `${locale}: ${product.id}`);
    for (const category of DEMO_CATEGORIES)
      assert.ok(text.categories[category.id], `${locale}: ${category.id}`);
    assert.equal(text.steps.length, 3);
  }
});

test("translated catalogues keep ids, prices and order", () => {
  const english = getDemoProducts("en");
  assert.deepEqual(
    english.map(({ id, price }) => [id, price]),
    DEMO_PRODUCTS.map(({ id, price }) => [id, price]),
  );
  assert.equal(english[0].name, "City bike");
  assert.equal(getDemoProducts()[0].name, "Vélo de ville");
  assert.equal(getDemoCategories("de")[0].name, "Fahrräder");
});

test("the demo language falls back to French for a missing or unknown value", () => {
  assert.equal(getDemoLocale("en"), "en");
  assert.equal(getDemoLocale(["pl", "en"]), "pl");
  assert.equal(getDemoLocale(undefined), "fr");
  assert.equal(getDemoLocale("xx"), "fr");
});

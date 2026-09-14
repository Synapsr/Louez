import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./product-page.loader.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(
  source.slice(source.indexOf("const loadRelatedProducts"), source.indexOf("const readStoredAxes")),
);

test("related cards retain catalog booking data and exclude the current product before pagination", async () => {
  const card = {
    id: "related",
    bookingAttributeAxes: [{ key: "size", values: ["S", "L"] }],
    accessories: [{ id: "helmet", required: true, requiredQuantity: 1 }],
    seasonalPricings: [{ id: "summer", basePrice: 80 }],
  };
  let calls = 0;
  const load = runInNewContext(`${compiled}; loadRelatedProducts`, {
    RELATED_PRODUCTS_LIMIT: 12,
    loadCatalogProducts: async (input) => {
      calls += 1;
      assert.equal(input.storeId, "store");
      assert.equal(input.category, "category");
      assert.equal(input.excludeProductId, "current");
      assert.equal(input.limit, 12);
      return { products: [card] };
    },
  });
  const cards = await load("store", { id: "current", categoryId: "category" });
  assert.deepEqual(cards, [card]);
  assert.equal(calls, 1);
  assert.equal((await load("store", { id: "current", categoryId: null })).length, 0);
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as orm from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { productUnits, products } from "@louez/db/schema";

const source = readFileSync(new URL("./catalog.queries.ts", import.meta.url), "utf8");
const querySource = source.slice(
  source.indexOf("const escapeLikePattern"),
  source.indexOf("/** Price the index"),
);
const compiled = stripTypeScriptTypes(querySource);

const loadRules = (db) =>
  runInNewContext(`${compiled}; ({ buildProductConditions, getFilteredAvailableQuantity })`, {
    ...orm,
    db,
    products,
    productUnits,
    activeProductsOf: (storeId) =>
      orm.and(orm.eq(products.storeId, storeId), orm.eq(products.status, "active")),
    effectiveProductQuantitySql: () => products.quantity,
    UNCATEGORIZED_CATEGORY_VALUE: "uncategorized",
    ALL_CATEGORIES_VALUE: "all",
    isReservedCategoryValue: () => false,
  });

test("catalog combines variant axes on the same active unit and counts matching units", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.function("json_unquote", (value) => value);
  try {
    sqlite.exec(`
      CREATE TABLE products (id TEXT, store_id TEXT, product_status TEXT, stock_kind TEXT, quantity INTEGER);
      CREATE TABLE product_units (product_id TEXT, lifecycle_status TEXT, attributes TEXT);
      INSERT INTO products VALUES
        ('split', 'store', 'active', 'returnable', 2),
        ('match', 'store', 'active', 'returnable', 3),
        ('foreign', 'other', 'active', 'returnable', 2),
        ('draft', 'store', 'draft', 'returnable', 2);
      INSERT INTO product_units VALUES
        ('split', 'active', '{"color":"red","size":"S"}'),
        ('split', 'active', '{"color":"blue","size":"L"}'),
        ('split', 'retired', '{"color":"red","size":"L"}'),
        ('match', 'active', '{"color":"red","size":"L"}'),
        ('match', 'active', '{"color":"red","size":"L"}'),
        ('match', 'active', '{"color":"blue","size":"L"}'),
        ('foreign', 'active', '{"color":"red","size":"L"}'),
        ('draft', 'active', '{"color":"red","size":"L"}');
    `);
    const db = drizzle(async (sql, params) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    });
    const { buildProductConditions } = loadRules(db);
    const find = async (extra = {}) =>
      (
        await db
          .select({ id: products.id })
          .from(products)
          .where(
            buildProductConditions({
              storeId: "store",
              category: null,
              search: "",
              attributes: { color: ["red"], size: ["L"] },
              ...extra,
            }),
          )
      ).map((row) => row.id);
    assert.deepEqual(await find(), ["match"]);
    assert.deepEqual(await find({ quantity: 2 }), ["match"]);
    assert.deepEqual(await find({ quantity: 3 }), []);
    assert.deepEqual(await find({ excludeProductId: "match" }), []);
    assert.deepEqual(await find({ attributes: { color: ["red", "blue"], size: ["L"] } }), [
      "split",
      "match",
    ]);
  } finally {
    sqlite.close();
  }
});

test("dated catalog availability counts selected combinations and keeps accessory limits", () => {
  const { getFilteredAvailableQuantity } = loadRules(undefined);
  const combinations = [
    { selectedAttributes: { color: "red", size: "L" }, availableQuantity: 0 },
    { selectedAttributes: { color: "blue", size: "L" }, availableQuantity: 3 },
    { selectedAttributes: { color: "red", size: "S" }, availableQuantity: 2 },
  ];
  const product = { availableQuantity: 5, combinations };
  assert.equal(getFilteredAvailableQuantity(product, { color: ["red"], size: ["L"] }), 0);
  assert.equal(getFilteredAvailableQuantity(product, { color: ["red", "blue"], size: ["L"] }), 3);
  assert.equal(
    getFilteredAvailableQuantity({ ...product, availableQuantity: 1 }, { size: ["L"] }),
    1,
  );
  assert.equal(
    getFilteredAvailableQuantity({ ...product, availableQuantity: 0 }, { size: ["L"] }),
    0,
  );
  assert.equal(getFilteredAvailableQuantity(product, {}), 5);
  assert.equal(getFilteredAvailableQuantity({ availableQuantity: null }, {}), null);
  assert.equal(getFilteredAvailableQuantity({ availableQuantity: 5 }, { size: ["L"] }), 0);
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type BrowsableCatalogProduct,
  applyCatalogParams,
  bucketProductsByCategory,
  buildCatalogHref,
  countActiveCatalogFilters,
  countAvailableByCategory,
  filterBookableProducts,
  filterCatalogProducts,
  filterProductsByAvailableQuantity,
  getCatalogTitle,
  readCatalogFilters,
  sortCatalogProducts,
  toggleCatalogAttribute,
} from "./util.rental-browse";

/** Neither price, quantity nor attributes: the rest of what `filterCatalogProducts` expects. */
const NO_PRICE = { minPrice: null, maxPrice: null, quantity: null, attributes: {} };

const categories = [
  { id: "cat-b", name: "Vélos", order: 1, productCount: 2 },
  { id: "cat-a", name: "Kayaks", order: 0, productCount: 1 },
];

const products = [
  { id: "p1", name: "Vélo route", description: null, price: "30", categoryIds: ["cat-b"] },
  { id: "p2", name: "Kayak", description: "Deux places", price: "45.5", categoryIds: ["cat-a"] },
  { id: "p3", name: "Casque", description: null, price: "5", categoryIds: [] },
  { id: "p4", name: "VTT", description: "Vélo tout terrain", price: "40", categoryIds: ["cat-b"] },
];

describe("readCatalogFilters / applyCatalogParams", () => {
  test("reads the URL and falls back to defaults on unknown values", () => {
    const filters = readCatalogFilters(
      new URLSearchParams("category=cat-a&search=+kay+&sort=bogus"),
    );
    assert.deepEqual(filters, {
      category: "cat-a",
      search: "kay",
      startDate: null,
      endDate: null,
      sort: "recommended",
      minPrice: null,
      maxPrice: null,
      availableOnly: true,
      quantity: null,
      attributes: {},
    });
  });

  test("defaults dated browsing to available and preserves an explicit opt-out", () => {
    const dates = new URLSearchParams({
      startDate: "2026-09-17T07:00:00.000Z",
      endDate: "2026-09-17T16:00:00.000Z",
    });
    assert.equal(readCatalogFilters(dates).availableOnly, true);
    const unchecked = applyCatalogParams(dates, { availableOnly: false });
    assert.equal(readCatalogFilters(unchecked).availableOnly, false);
    assert.equal(
      readCatalogFilters(
        applyCatalogParams(unchecked, {
          endDate: "2026-09-18T16:00:00.000Z",
        }),
      ).availableOnly,
      false,
    );
    assert.equal(
      readCatalogFilters(
        applyCatalogParams(unchecked, {
          availableOnly: null,
        }),
      ).availableOnly,
      true,
    );
    dates.delete("endDate");
    assert.equal(readCatalogFilters(dates).availableOnly, true);
    dates.set("endDate", "invalid");
    assert.equal(readCatalogFilters(dates).availableOnly, true);
    dates.set("endDate", "2026-09-16T16:00:00.000Z");
    assert.equal(readCatalogFilters(dates).availableOnly, true);
  });

  test("reads the quantity and the attribute entries, skipping what is malformed", () => {
    const filters = readCatalogFilters(
      new URLSearchParams("quantity=4&attr=size:M&attr=size:L&attr=size:M&attr=broken&attr=:x"),
    );
    assert.equal(filters.quantity, 4);
    assert.deepEqual(filters.attributes, { size: ["M", "L"] });
    assert.equal(readCatalogFilters(new URLSearchParams("quantity=1")).quantity, null);
    assert.equal(readCatalogFilters(new URLSearchParams("quantity=two")).quantity, null);
  });

  test("reads price bounds and the availability flag", () => {
    const filters = readCatalogFilters(
      new URLSearchParams("minPrice=10&maxPrice=42.5&availableOnly=1"),
    );
    assert.equal(filters.minPrice, 10);
    assert.equal(filters.maxPrice, 42.5);
    assert.equal(filters.availableOnly, true);
  });

  test("drops a price bound that is not a positive number, and an inverted range", () => {
    const bogus = readCatalogFilters(new URLSearchParams("minPrice=cheap&maxPrice=-3"));
    assert.equal(bogus.minPrice, null);
    assert.equal(bogus.maxPrice, null);

    const inverted = readCatalogFilters(new URLSearchParams("minPrice=80&maxPrice=20"));
    assert.equal(inverted.minPrice, null);
    assert.equal(inverted.maxPrice, null);
  });

  test("drops defaults and empties, keeps the rest", () => {
    const current = new URLSearchParams(
      "startDate=2026-09-10T07:00:00.000Z&endDate=2026-09-12T16:00:00.000Z&category=cat-a",
    );
    const next = applyCatalogParams(current, { category: null, search: "  ", sort: "recommended" });
    assert.equal(
      next.toString(),
      "startDate=2026-09-10T07%3A00%3A00.000Z&endDate=2026-09-12T16%3A00%3A00.000Z",
    );

    const sorted = applyCatalogParams(next, { sort: "priceAsc", search: " vélo " });
    assert.equal(sorted.get("sort"), "priceAsc");
    assert.equal(sorted.get("search"), "vélo");
  });

  test("writes price bounds and the availability flag, and clears them again", () => {
    const set = applyCatalogParams(new URLSearchParams(), {
      minPrice: 10,
      maxPrice: 42.5,
      availableOnly: true,
    });
    assert.equal(set.toString(), "minPrice=10&maxPrice=42.5&availableOnly=1");

    const cleared = applyCatalogParams(set, {
      minPrice: null,
      maxPrice: null,
      availableOnly: false,
    });
    assert.equal(cleared.toString(), "availableOnly=0");
  });

  test("writes the quantity and one attr entry per value, and replaces them wholesale", () => {
    const set = applyCatalogParams(new URLSearchParams("attr=size:S"), {
      quantity: 3,
      attributes: { size: ["M", "L"], color: ["red"] },
    });
    assert.equal(set.toString(), "attr=size%3AM&attr=size%3AL&attr=color%3Ared&quantity=3");

    const cleared = applyCatalogParams(set, { quantity: 1, attributes: null });
    assert.equal(cleared.toString(), "");
  });

  test("buildCatalogHref keeps the plain address when nothing is set", () => {
    assert.equal(buildCatalogHref(new URLSearchParams()), "/catalog");
    assert.equal(buildCatalogHref(new URLSearchParams("category=all")), "/catalog?category=all");
  });
});

describe("filterCatalogProducts", () => {
  test("filters by real category, 'uncategorized' and 'all'", () => {
    assert.deepEqual(
      filterCatalogProducts(products, { category: "cat-b", search: "", ...NO_PRICE }).map(
        (p) => p.id,
      ),
      ["p1", "p4"],
    );
    assert.deepEqual(
      filterCatalogProducts(products, { category: "uncategorized", search: "", ...NO_PRICE }).map(
        (p) => p.id,
      ),
      ["p3"],
    );
    assert.equal(
      filterCatalogProducts(products, { category: "all", search: "", ...NO_PRICE }).length,
      4,
    );
    assert.equal(
      filterCatalogProducts(products, { category: null, search: "", ...NO_PRICE }).length,
      4,
    );
  });

  test("matches the search on name or description, case-insensitive", () => {
    assert.deepEqual(
      filterCatalogProducts(products, { category: null, search: "VÉLO", ...NO_PRICE }).map(
        (p) => p.id,
      ),
      ["p1", "p4"],
    );
    assert.deepEqual(
      filterCatalogProducts(products, { category: "cat-a", search: "places", ...NO_PRICE }).map(
        (p) => p.id,
      ),
      ["p2"],
    );
  });

  test("keeps the products inside the price range, bounds included", () => {
    assert.deepEqual(
      filterCatalogProducts(products, {
        ...NO_PRICE,
        category: null,
        search: "",
        minPrice: 30,
        maxPrice: 40,
      }).map((p) => p.id),
      ["p1", "p4"],
    );
    assert.deepEqual(
      filterCatalogProducts(products, {
        category: null,
        search: "",
        minPrice: null,
        maxPrice: 30,
        quantity: null,
        attributes: {},
      }).map((p) => p.id),
      ["p1", "p3"],
    );
  });

  test("compares the period price when the server computed one", () => {
    const priced = products.map((p) => ({ ...p, displayPrice: 100 }));
    assert.equal(
      filterCatalogProducts(priced, { ...NO_PRICE, category: null, search: "", maxPrice: 50 })
        .length,
      0,
    );
  });

  test("keeps the products whose fleet holds the quantity; untracked stock always does", () => {
    const stocked = [
      { ...products[0]!, quantity: 2 },
      { ...products[1]!, quantity: 5 },
      { ...products[2]!, quantity: null },
    ];
    assert.deepEqual(
      filterCatalogProducts(stocked, { ...NO_PRICE, category: null, search: "", quantity: 3 }).map(
        (p) => p.id,
      ),
      ["p2", "p3"],
    );
  });

  test("attributes: any picked value on an axis, every picked axis", () => {
    const withUnits: BrowsableCatalogProduct[] = [
      { ...products[0]!, attributeValues: { size: ["S", "M"], color: ["red"] } },
      { ...products[1]!, attributeValues: { size: ["L"] } },
      { ...products[2]!, attributeValues: {} },
    ];
    const pick = (attributes: Record<string, string[]>) =>
      filterCatalogProducts(withUnits, { ...NO_PRICE, category: null, search: "", attributes }).map(
        (p) => p.id,
      );
    assert.deepEqual(pick({ size: ["M", "L"] }), ["p1", "p2"]);
    assert.deepEqual(pick({ size: ["M"], color: ["red"] }), ["p1"]);
    assert.deepEqual(pick({ size: ["L"], color: ["red"] }), []);
    assert.deepEqual(pick({ size: [] }), ["p1", "p2", "p3"]);
  });
});

describe("toggleCatalogAttribute", () => {
  test("adds, removes, and drops an emptied axis", () => {
    const one = toggleCatalogAttribute({}, "size", "M", true);
    assert.deepEqual(one, { size: ["M"] });
    const two = toggleCatalogAttribute(one, "size", "L", true);
    assert.deepEqual(two, { size: ["M", "L"] });
    assert.deepEqual(toggleCatalogAttribute(two, "size", "M", true), two);
    assert.deepEqual(toggleCatalogAttribute(two, "size", "M", false), { size: ["L"] });
    assert.deepEqual(toggleCatalogAttribute(one, "size", "M", false), {});
  });
});

describe("filterProductsByAvailableQuantity", () => {
  test("keeps what the period can book that many of; unknown and untracked pass", () => {
    const availability = new Map([
      ["p1", { availableQuantity: 1 }],
      ["p2", { availableQuantity: 4 }],
      ["p3", { availableQuantity: null }],
    ]);
    assert.deepEqual(
      filterProductsByAvailableQuantity(products, 3, availability).map((p) => p.id),
      ["p2", "p3", "p4"],
    );
    assert.equal(filterProductsByAvailableQuantity(products, 3, new Map()).length, 4);
  });
});

describe("countAvailableByCategory", () => {
  const catalogCategories = [
    { id: "cat-a", productIds: ["p2"] },
    { id: "cat-b", productIds: ["p1", "p4"] },
  ];

  test("counts the bookable products per row, once each in the total", () => {
    const counts = countAvailableByCategory(
      catalogCategories,
      ["p3"],
      new Map([
        ["p1", 0],
        ["p2", 2],
        ["p3", null],
      ]),
    );
    assert.deepEqual(
      [...(counts?.byCategoryId.entries() ?? [])],
      [
        ["cat-a", 1],
        ["cat-b", 1],
      ],
    );
    assert.equal(counts?.uncategorized, 1);
    assert.equal(counts?.total, 3);
  });

  test("is null until availability has answered", () => {
    assert.equal(countAvailableByCategory(catalogCategories, [], null), null);
  });
});

describe("filterBookableProducts", () => {
  test("hides what the period cannot book", () => {
    const availability = new Map([
      ["p1", { status: "available" as const }],
      ["p2", { status: "limited" as const }],
      ["p3", { status: "unavailable" as const }],
      ["p4", { status: "out_of_stock" as const }],
    ]);
    assert.deepEqual(
      filterBookableProducts(products, availability).map((p) => p.id),
      ["p1", "p2"],
    );
  });

  test("uses known stock without dates and keeps untracked or unknown stock", () => {
    const stock = [
      { ...products[0], quantity: 0 },
      { ...products[1], quantity: 2 },
      { ...products[2], quantity: null },
      products[3],
    ];
    assert.deepEqual(
      filterBookableProducts(stock, new Map()).map((p) => p.id),
      ["p2", "p3", "p4"],
    );
  });

  test("hides nothing while availability has not answered", () => {
    assert.equal(filterBookableProducts(products, new Map()).length, 4);
  });
});

describe("countActiveCatalogFilters", () => {
  test("counts the category, the price range once, the flags, and one per picked axis", () => {
    const none = {
      category: null,
      minPrice: null,
      maxPrice: null,
      availableOnly: true,
      quantity: null,
      attributes: {},
    };
    assert.equal(countActiveCatalogFilters(none), 0);
    assert.equal(countActiveCatalogFilters({ ...none, category: "all" }), 0);
    assert.equal(countActiveCatalogFilters({ ...none, category: "cat-a" }), 1);
    assert.equal(countActiveCatalogFilters({ ...none, minPrice: 10, maxPrice: 20 }), 1);
    assert.equal(countActiveCatalogFilters({ ...none, quantity: 4 }), 1);
    assert.equal(
      countActiveCatalogFilters({ ...none, attributes: { size: ["M", "L"], color: ["red"] } }),
      2,
    );
    assert.equal(
      countActiveCatalogFilters({
        ...none,
        category: "cat-a",
        minPrice: 10,
        availableOnly: false,
      }),
      3,
    );
  });
});

describe("sortCatalogProducts", () => {
  test("recommended: category order, then availability, then server order", () => {
    const availabilityByProductId = new Map([
      ["p1", { status: "unavailable" as const }],
      ["p4", { status: "available" as const }],
    ]);
    const sorted = sortCatalogProducts(products, { categories, availabilityByProductId });
    assert.deepEqual(
      sorted.map((p) => p.id),
      ["p2", "p4", "p1", "p3"],
    );
  });

  test("without availability the server order wins inside a category", () => {
    const sorted = sortCatalogProducts(products, { categories });
    assert.deepEqual(
      sorted.map((p) => p.id),
      ["p2", "p1", "p4", "p3"],
    );
  });

  test("price sorts ignore categories and keep server order on ties", () => {
    const withTie = [...products, { id: "p5", name: "Bidon", price: 5, categoryIds: ["cat-a"] }];
    assert.deepEqual(
      sortCatalogProducts(withTie, { categories, sort: "priceAsc" }).map((p) => p.id),
      ["p3", "p5", "p1", "p4", "p2"],
    );
    assert.deepEqual(
      sortCatalogProducts(withTie, { categories, sort: "priceDesc" }).map((p) => p.id),
      ["p2", "p4", "p1", "p3", "p5"],
    );
  });

  test("price sorts use the period price when the server computed one", () => {
    const priced = products.map((p, index) => ({ ...p, displayPrice: 100 - index * 10 }));
    assert.deepEqual(
      sortCatalogProducts(priced, { categories, sort: "priceAsc" }).map((p) => p.id),
      ["p4", "p3", "p2", "p1"],
    );
  });

  test("does not mutate the input", () => {
    const input = [...products];
    sortCatalogProducts(input, { categories, sort: "priceDesc" });
    assert.deepEqual(
      input.map((p) => p.id),
      ["p1", "p2", "p3", "p4"],
    );
  });
});

describe("bucketProductsByCategory", () => {
  test("buckets by category and keeps the uncategorized apart", () => {
    const multi = { id: "p6", name: "Combo", price: "1", categoryIds: ["cat-a", "cat-b"] };
    const { byCategoryId, uncategorized } = bucketProductsByCategory([...products, multi]);
    assert.deepEqual(
      byCategoryId.get("cat-a")?.map((p) => p.id),
      ["p2", "p6"],
    );
    assert.deepEqual(
      byCategoryId.get("cat-b")?.map((p) => p.id),
      ["p1", "p4", "p6"],
    );
    assert.deepEqual(
      uncategorized.map((p) => p.id),
      ["p3"],
    );
  });
});

describe("getCatalogTitle", () => {
  const labels = { catalog: "Catalogue", others: "Autres" };

  test("names the category, 'Autres', or the catalog", () => {
    assert.equal(getCatalogTitle("cat-a", categories, labels), "Kayaks");
    assert.equal(getCatalogTitle("uncategorized", categories, labels), "Autres");
    assert.equal(getCatalogTitle("all", categories, labels), "Catalogue");
    assert.equal(getCatalogTitle(null, categories, labels), "Catalogue");
    assert.equal(getCatalogTitle("missing", categories, labels), "Catalogue");
  });
});

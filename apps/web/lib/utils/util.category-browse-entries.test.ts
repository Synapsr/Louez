import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCategoryBrowseEntries,
  buildCategoryBrowseHref,
  bucketProductLinks,
} from "./util.category-browse-entries";

const labels = { others: "Autres", othersDescription: "Sans catégorie", all: "Tous les produits" };

const categories = [
  { id: "kayak", name: "Kayaks", description: null, imageUrl: null },
  { id: "paddle", name: "Paddles", description: "Rigides", imageUrl: "https://img/paddle.jpg" },
  { id: "empty", name: "Vide", description: null, imageUrl: null },
];

const productLinks = [
  { productId: "p1", images: ["https://img/p1.jpg"], categoryId: "kayak" },
  { productId: "p2", images: null, categoryId: "kayak" },
  { productId: "p3", images: ["https://img/p3.jpg"], categoryId: "paddle" },
  { productId: "p4", images: ["https://img/p4.jpg"], categoryId: null },
  // A product in two categories counts once in the total.
  { productId: "p3", images: ["https://img/p3.jpg"], categoryId: "kayak" },
];

describe("buildCategoryBrowseHref", () => {
  it("links the plain catalog for all and a filter otherwise", () => {
    assert.equal(buildCategoryBrowseHref("all"), "/catalog");
    assert.equal(buildCategoryBrowseHref("uncategorized"), "/catalog?category=uncategorized");
    assert.equal(buildCategoryBrowseHref("a b"), "/catalog?category=a%20b");
  });
});

describe("bucketProductLinks", () => {
  it("counts per bucket, keeps the first image and counts products once", () => {
    const buckets = bucketProductLinks(productLinks);
    assert.deepEqual(buckets.byCategoryId.get("kayak"), {
      count: 3,
      imageUrl: "https://img/p1.jpg",
    });
    assert.deepEqual(buckets.uncategorized, { count: 1, imageUrl: "https://img/p4.jpg" });
    assert.equal(buckets.productCount, 4);
  });
});

describe("buildCategoryBrowseEntries", () => {
  it("builds populated tiles, others, then all, each with a link", () => {
    const entries = buildCategoryBrowseEntries({ categories, productLinks, labels });
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.variant, entry.totalCount, entry.href]),
      [
        ["kayak", "category", 3, "/catalog?category=kayak"],
        ["paddle", "category", 1, "/catalog?category=paddle"],
        ["uncategorized", "uncategorized", 1, "/catalog?category=uncategorized"],
        ["all", "all", 4, "/catalog"],
      ],
    );
    // A category image wins over the borrowed product visual.
    assert.equal(entries[1].imageUrl, "https://img/paddle.jpg");
    assert.equal(entries[0].imageUrl, "https://img/p1.jpg");
  });

  it("is empty with fewer than two populated categories", () => {
    const entries = buildCategoryBrowseEntries({
      categories,
      productLinks: productLinks.filter((link) => link.categoryId !== "paddle"),
      labels,
    });
    assert.deepEqual(entries, []);
  });
});

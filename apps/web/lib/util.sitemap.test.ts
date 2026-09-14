import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStoreSitemap } from "./util.sitemap";

const canonicalUrl = (slug: string, path = "") => `https://${slug}.example.test${path}`;

describe("buildStoreSitemap", () => {
  it("lists home, catalog, populated categories, products and the information pages", () => {
    const entries = buildStoreSitemap({
      store: { slug: "ddm", updatedAt: new Date("2026-01-01"), hasTerms: true },
      products: [
        { id: "p1", slug: "vae-trekking", updatedAt: new Date("2026-03-01") },
        { id: "p2", slug: null, updatedAt: new Date("2026-02-01") },
      ],
      categories: [
        { id: "c1", slug: "velos", productCount: 2 },
        { id: "vide", productCount: 0 },
      ],
      canonicalUrl,
    });

    assert.deepEqual(
      entries.map((entry) => entry.url),
      [
        "https://ddm.example.test",
        "https://ddm.example.test/catalog",
        "https://ddm.example.test/catalog?category=velos",
        "https://ddm.example.test/product/vae-trekking",
        "https://ddm.example.test/product/p2",
        "https://ddm.example.test/about",
        "https://ddm.example.test/contact",
        "https://ddm.example.test/terms",
        "https://ddm.example.test/legal",
      ],
    );
  });

  it("dates the home and the catalog from the latest product change", () => {
    const [home, catalog] = buildStoreSitemap({
      store: { slug: "ddm", updatedAt: new Date("2026-01-01"), hasTerms: true },
      products: [{ id: "p1", updatedAt: new Date("2026-03-01") }],
      categories: [],
      canonicalUrl,
    });

    assert.deepEqual(home.lastModified, new Date("2026-03-01"));
    assert.deepEqual(catalog.lastModified, new Date("2026-03-01"));
  });

  it("falls back to the store date and leaves the terms out when unwritten", () => {
    const entries = buildStoreSitemap({
      store: { slug: "ddm", updatedAt: new Date("2026-01-01"), hasTerms: false },
      products: [],
      categories: [],
      canonicalUrl,
    });

    assert.deepEqual(entries[0].lastModified, new Date("2026-01-01"));
    assert.ok(!entries.some((entry) => entry.url.endsWith("/terms")));
    assert.ok(entries.some((entry) => entry.url.endsWith("/legal")));
  });

  it("encodes the category id in the query string", () => {
    const entries = buildStoreSitemap({
      store: { slug: "ddm", hasTerms: true },
      products: [],
      categories: [{ id: "a b&c", productCount: 1 }],
      canonicalUrl,
    });

    assert.equal(entries[2].url, "https://ddm.example.test/catalog?category=a%20b%26c");
  });
});

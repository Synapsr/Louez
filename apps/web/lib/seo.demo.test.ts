import assert from "node:assert/strict";
import { test } from "node:test";

import { generateProductMetadata, generateStoreMetadata } from "./seo";

// A demo store (lib/demo) is a visitor's sandbox: none of its pages is indexed, the
// pages a real store would open to search engines included.

const store = { id: "s1", name: "Cimes & Glisse", slug: "cimes-glisse-abc123" };
const product = {
  id: "p1",
  name: "Pack Découverte",
  slug: "pack-decouverte",
  price: "26.00",
  quantity: 40,
};

test("a demo store's pages are noindex, a real store's are not", () => {
  const demo = generateStoreMetadata({ ...store, demoVertical: "ski" });
  assert.equal((demo.robots as { index?: boolean }).index, false);
  const real = generateStoreMetadata(store);
  assert.equal((real.robots as { index?: boolean }).index, true);
});

test("a demo store's product page is noindex", () => {
  const metadata = generateProductMetadata({ ...store, demoVertical: "ski" }, product, {
    title: "Pack Découverte",
    description: "Skis, chaussures et bâtons",
  });
  assert.equal((metadata.robots as { index?: boolean }).index, false);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { getStorePageRobots } from "./seo.robots";

afterEach(() => {
  delete process.env.LOUEZ_SEARCH_INDEXING;
});

test("without the switch, store pages stay indexable and funnels keep their links", () => {
  assert.deepEqual(getStorePageRobots(false), {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
  });
  assert.deepEqual(getStorePageRobots(true), { index: false, follow: true });
});

test("with LOUEZ_SEARCH_INDEXING=off, every store page says noindex, nofollow", () => {
  process.env.LOUEZ_SEARCH_INDEXING = "off";
  assert.deepEqual(getStorePageRobots(false), { index: false, follow: false });
  assert.deepEqual(getStorePageRobots(true), { index: false, follow: false });
});

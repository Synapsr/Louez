import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStoreHomeSections } from "./util.store-home-sections";

test("a store that never chose shows every block", () => {
  const everything = { map: true, reviews: true, reassurance: true };

  assert.deepEqual(resolveStoreHomeSections(null), everything);
  assert.deepEqual(resolveStoreHomeSections(undefined), everything);
  assert.deepEqual(resolveStoreHomeSections({}), everything);
  assert.deepEqual(resolveStoreHomeSections({ homeSections: null }), everything);
});

test("a block turned off stays off, the others stay on", () => {
  assert.deepEqual(
    resolveStoreHomeSections({ homeSections: { map: false, reviews: true, reassurance: true } }),
    { map: false, reviews: true, reassurance: true },
  );
  assert.deepEqual(
    resolveStoreHomeSections({ homeSections: { map: false, reviews: false, reassurance: false } }),
    { map: false, reviews: false, reassurance: false },
  );
});

test("a block the saved theme predates shows", () => {
  assert.deepEqual(resolveStoreHomeSections({ homeSections: { reviews: false } }), {
    map: true,
    reviews: false,
    reassurance: true,
  });
});

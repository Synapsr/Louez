import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { isSearchIndexingEnabled, resolveSearchIndexing } from "./search-indexing";

afterEach(() => {
  delete process.env.LOUEZ_SEARCH_INDEXING;
});

test("only `off` turns search indexing off", () => {
  assert.equal(resolveSearchIndexing("off"), "off");
  assert.equal(resolveSearchIndexing("on"), "on");
  assert.equal(resolveSearchIndexing(undefined), "on");
  assert.equal(resolveSearchIndexing(""), "on");
  assert.equal(resolveSearchIndexing("OFF"), "on");
});

test("an instance without the variable stays indexable", () => {
  delete process.env.LOUEZ_SEARCH_INDEXING;
  assert.equal(isSearchIndexingEnabled(), true);
});

test("the variable is read at call time", () => {
  process.env.LOUEZ_SEARCH_INDEXING = "off";
  assert.equal(isSearchIndexingEnabled(), false);
  process.env.LOUEZ_SEARCH_INDEXING = "on";
  assert.equal(isSearchIndexingEnabled(), true);
});

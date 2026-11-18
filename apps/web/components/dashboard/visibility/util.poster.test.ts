import assert from "node:assert/strict";
import test from "node:test";

import { toDisplayUrl, wrapLines } from "./util.poster";

// One unit per character keeps the arithmetic readable.
const measure = (value: string) => value.length;

test("keeps a short name on one line", () => {
  assert.deepEqual(wrapLines("Vélos du Port", 20, measure, 2), ["Vélos du Port"]);
});

test("wraps a long name at word boundaries", () => {
  assert.deepEqual(wrapLines("Location de kayaks du Golfe", 18, measure, 2), [
    "Location de kayaks",
    "du Golfe",
  ]);
});

test("cuts what does not fit with an ellipsis", () => {
  const lines = wrapLines("un deux trois quatre cinq six", 9, measure, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1]?.endsWith("…"));
  assert.ok((lines[1]?.length ?? 0) <= 9);
});

test("keeps a word wider than a line whole", () => {
  assert.deepEqual(wrapLines("Superlocationdemateriel", 10, measure, 2), [
    "Superlocationdemateriel",
  ]);
});

test("prints the address without protocol or trailing slash", () => {
  assert.equal(toDisplayUrl("https://velos.louez.io/"), "velos.louez.io");
  assert.equal(toDisplayUrl("http://localhost:3000/velos"), "localhost:3000/velos");
});

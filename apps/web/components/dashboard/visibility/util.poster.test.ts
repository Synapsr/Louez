import assert from "node:assert/strict";
import test from "node:test";

import { isSquarish, monogram, posterColors, toDisplayUrl, wrapLines } from "./util.poster";

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

test("a dark store colour paints the band and the code", () => {
  assert.deepEqual(posterColors("#0F3D2E"), {
    accent: "#0F3D2E",
    onAccent: posterColors("#0F3D2E").onAccent,
    code: "#0F3D2E",
  });
  assert.notEqual(posterColors("#0F3D2E").onAccent, posterColors("#0F3D2E").accent);
});

test("a light store colour paints the band, but the code stays dark enough to scan", () => {
  const yellow = posterColors("#FFD400");
  assert.equal(yellow.accent, "#FFD400");
  assert.equal(yellow.code, "#0a0a0a");
  // The platform blue passes 4.5:1 on white: the code takes it.
  assert.equal(posterColors("#0066FF").code, "#0066FF");
});

test("no colour, or one that is not a colour, prints in ink", () => {
  for (const value of [null, undefined, "", "blue", "#12"]) {
    assert.deepEqual(posterColors(value), {
      accent: "#0a0a0a",
      onAccent: "#ffffff",
      code: "#0a0a0a",
    });
  }
});

test("the code's badge shows a squarish logo, else the store's initial", () => {
  assert.equal(isSquarish({ naturalWidth: 200, naturalHeight: 200 }), true);
  assert.equal(isSquarish({ naturalWidth: 480, naturalHeight: 140 }), false);
  assert.equal(monogram("  Vélo Évasion"), "V");
  assert.equal(monogram("« élan » location"), "É");
  assert.equal(monogram("…"), "");
});

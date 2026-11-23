import assert from "node:assert/strict";
import test from "node:test";

import { describeLineAttributes } from "./util.line-attributes";

const axes = [
  { key: "color", label: "Couleur", position: 1 },
  { key: "size", label: "Taille", position: 0 },
];

test("a line booked on an exact combination shows its values in axis order", () => {
  assert.deepEqual(
    describeLineAttributes({
      selectedAttributes: { color: "Rouge", size: "L" },
      combinationKey: "size:L|color:Rouge",
      axes,
      trackUnits: true,
    }),
    [
      { key: "size", label: "Taille", value: "L" },
      { key: "color", label: "Couleur", value: "Rouge" },
    ],
  );
});

test("a line that left its size open shows it open, never as a value", () => {
  assert.deepEqual(
    describeLineAttributes({
      selectedAttributes: null,
      combinationKey: null,
      axes: [{ key: "size", label: "Taille", position: 0 }],
      trackUnits: true,
    }),
    [{ key: "size", label: "Taille", value: null }],
  );
});

test("a partial choice shows what was chosen and what was left open", () => {
  assert.deepEqual(
    describeLineAttributes({
      selectedAttributes: { color: "Rouge" },
      combinationKey: "__default",
      axes,
      trackUnits: true,
    }),
    [
      { key: "size", label: "Taille", value: null },
      { key: "color", label: "Couleur", value: "Rouge" },
    ],
  );
});

test("a product counted by quantity lists no open axis", () => {
  assert.deepEqual(
    describeLineAttributes({
      selectedAttributes: {},
      combinationKey: null,
      axes,
      trackUnits: false,
    }),
    [],
  );
});

test("a value from an axis the product no longer has is kept, after the axes", () => {
  assert.deepEqual(
    describeLineAttributes({
      selectedAttributes: { size: "M", frame: "Carbone" },
      combinationKey: "size:M",
      axes: [{ key: "size", label: "Taille", position: 0 }],
      trackUnits: true,
    }),
    [
      { key: "size", label: "Taille", value: "M" },
      { key: "frame", label: "frame", value: "Carbone" },
    ],
  );
});

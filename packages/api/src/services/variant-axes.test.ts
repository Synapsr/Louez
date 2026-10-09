import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";

import type { BookingAttributeAxis } from "@louez/types";

// @louez/utils is a CommonJS workspace package: its named exports are not
// statically visible to the ESM loader, so hand them over through require.
const require = createRequire(import.meta.url);
const variantUtils: Record<string, unknown> = require("@louez/utils");

mock.module("@louez/utils", { namedExports: variantUtils });
mock.module("@louez/db", {
  namedExports: {
    productUnits: {},
    products: {},
    reservationItems: {},
  },
});

const {
  groupIdsByNextCombinationKey,
  removeMatchingAxis,
  selectProductsUsingVariant,
  stripMatchingAttributes,
} = await import("./variant-axes");

const sizeAndColor: BookingAttributeAxis[] = [
  { key: "size", label: "Taille", position: 0 },
  { key: "color", label: "Couleur", position: 1 },
];

test("removeMatchingAxis drops the axis and renumbers the rest", () => {
  assert.deepEqual(removeMatchingAxis(sizeAndColor, { key: "size", label: "Taille" }), [
    { key: "color", label: "Couleur", position: 0 },
  ]);
});

test("removeMatchingAxis matches a historical localized key through the preset aliases", () => {
  const legacy: BookingAttributeAxis[] = [{ key: "taille", label: "Taille", position: 0 }];
  assert.deepEqual(removeMatchingAxis(legacy, { key: "size", label: "Size" }), []);
});

test("removeMatchingAxis returns null when the product does not use the variant", () => {
  assert.equal(removeMatchingAxis(sizeAndColor, { key: "material", label: "Matière" }), null);
  assert.equal(removeMatchingAxis(null, { key: "size" }), null);
});

test("stripMatchingAttributes removes only the matching value", () => {
  assert.deepEqual(stripMatchingAttributes({ size: "M", color: "Rouge" }, { key: "size" }), {
    color: "Rouge",
  });
  assert.equal(stripMatchingAttributes({ color: "Rouge" }, { key: "size" }), null);
  assert.equal(stripMatchingAttributes(null, { key: "size" }), null);
});

test("groupIdsByNextCombinationKey merges units into the default key once the axis is gone", () => {
  const groups = groupIdsByNextCombinationKey(
    [],
    [
      { id: "u1", combinationKey: "size:M", attributes: { size: "M" } },
      { id: "u2", combinationKey: "size:L", attributes: { size: "L" } },
      { id: "u3", combinationKey: "__default", attributes: {} },
    ],
  );
  assert.deepEqual([...groups.entries()], [["__default", ["u1", "u2"]]]);
});

test("groupIdsByNextCombinationKey re-keys booked lines from their stored attributes", () => {
  const groups = groupIdsByNextCombinationKey(
    [{ key: "color", label: "Couleur", position: 0 }],
    [
      { id: "i1", combinationKey: "size:M|color:Rouge", attributes: { size: "M", color: "Rouge" } },
      { id: "i2", combinationKey: "color:Rouge", attributes: { color: "Rouge" } },
      { id: "i3", combinationKey: "size:M", attributes: { size: "M" } },
    ],
  );
  assert.deepEqual(
    [...groups.entries()],
    [
      ["color:Rouge", ["i1"]],
      ["__default", ["i3"]],
    ],
  );
});

test("selectProductsUsingVariant lists products using the variant by axis or by unit values", () => {
  const rows = [
    { id: "declared", axes: sizeAndColor },
    { id: "attribute-only", axes: null },
    { id: "untouched", axes: [{ key: "color", label: "Couleur", position: 0 }] },
  ];
  const units: Array<{ productId: string; attributes: Record<string, string> }> = [
    { productId: "attribute-only", attributes: { taille: "M" } },
    { productId: "untouched", attributes: { color: "Rouge" } },
  ];
  assert.deepEqual(
    selectProductsUsingVariant(rows, units, { key: "size", label: "Taille" }).map((row) => row.id),
    ["declared", "attribute-only"],
  );
});

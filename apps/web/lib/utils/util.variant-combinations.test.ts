import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BookingAttributeAxis } from "@louez/types";

import type { StorefrontProductUnit } from "@/lib/storefront/storefront.types";
import {
  deriveAttributeValues,
  groupUnitsIntoCombinations,
  inferAttributeAxesFromUnits,
  isBookableUnit,
} from "@/lib/utils/util.variant-combinations";

const axes: BookingAttributeAxis[] = [
  { key: "color", label: "Couleur", position: 1 },
  { key: "size", label: "Taille", position: 0 },
];

const units: StorefrontProductUnit[] = [
  { lifecycleStatus: "active", attributes: { size: "M", color: "red" } },
  { lifecycleStatus: null, attributes: { size: "S", color: "red" } },
  { lifecycleStatus: "active", inDowntimeNow: false, attributes: { size: "S", color: "red" } },
  { lifecycleStatus: "retired", attributes: { size: "L", color: "blue" } },
  { lifecycleStatus: "active", inDowntimeNow: true, attributes: { size: "M", color: "blue" } },
  { lifecycleStatus: "active", attributes: { size: " XL " } },
  { lifecycleStatus: "active", attributes: null },
];

describe("isBookableUnit", () => {
  test("active units without downtime are bookable, a missing status means active", () => {
    assert.equal(isBookableUnit({ lifecycleStatus: "active" }), true);
    assert.equal(isBookableUnit({ lifecycleStatus: null }), true);
    assert.equal(isBookableUnit({ lifecycleStatus: "retired" }), false);
    assert.equal(isBookableUnit({ lifecycleStatus: "active", inDowntimeNow: true }), false);
  });
});

describe("groupUnitsIntoCombinations", () => {
  test("counts bookable units per complete combination, in deterministic order", () => {
    // Sorted on the canonical "size:…|color:…" value; the incomplete unit and
    // the attribute-less one share the default combination.
    assert.deepEqual(groupUnitsIntoCombinations(axes, units), [
      {
        combinationKey: "size:M|color:red",
        selectedAttributes: { size: "M", color: "red" },
        availableQuantity: 1,
        totalQuantity: 1,
        reservedQuantity: 0,
        status: "available",
      },
      {
        combinationKey: "size:S|color:red",
        selectedAttributes: { size: "S", color: "red" },
        availableQuantity: 2,
        totalQuantity: 2,
        reservedQuantity: 0,
        status: "available",
      },
      {
        combinationKey: "__default",
        selectedAttributes: { size: " XL " },
        availableQuantity: 2,
        totalQuantity: 2,
        reservedQuantity: 0,
        status: "available",
      },
    ]);
  });

  test("yields nothing without units", () => {
    assert.deepEqual(groupUnitsIntoCombinations(axes, []), []);
  });
});

describe("deriveAttributeValues", () => {
  test("lists trimmed, sorted values from bookable units only", () => {
    assert.deepEqual(deriveAttributeValues(axes, { units }), {
      size: ["M", "S", "XL"],
      color: ["red"],
    });
  });

  test("reads the period combinations with stock alone once availability answered", () => {
    // The units are ignored: a value whose units are all reserved for the
    // period must not come back as selectable.
    assert.deepEqual(
      deriveAttributeValues(axes, {
        combinations: [
          { selectedAttributes: { size: "L", color: "green" }, availableQuantity: 1 },
          { selectedAttributes: { size: "XS", color: "black" }, availableQuantity: 0 },
        ],
        units,
      }),
      {
        size: ["L"],
        color: ["green"],
      },
    );
  });

  test("an answered period with nothing available lists no value, whatever the units", () => {
    assert.deepEqual(deriveAttributeValues(axes, { combinations: [], units }), {
      size: [],
      color: [],
    });
  });

  test("keeps an axis nobody has a value for", () => {
    assert.deepEqual(deriveAttributeValues(axes, {}), { size: [], color: [] });
  });
});

describe("inferAttributeAxesFromUnits", () => {
  test("builds one axis per attribute key, alphabetically, whatever the unit status", () => {
    assert.deepEqual(inferAttributeAxesFromUnits(units), [
      { key: "color", label: "color", position: 0 },
      { key: "size", label: "size", position: 1 },
    ]);
  });

  test("ignores blank keys and units without attributes", () => {
    assert.deepEqual(
      inferAttributeAxesFromUnits([{ attributes: { " ": "x" } }, { attributes: null }]),
      [],
    );
  });
});

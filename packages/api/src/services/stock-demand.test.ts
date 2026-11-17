import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, describe, mock, test } from "node:test";

import type { ReservationDemandLine } from "@louez/db";

import { stableStringify } from "../platform/hash";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// The stock a status change binds (`stockDemandOf`): one canonical form, so
// two reads of an unchanged reservation bind the same, whatever order the
// database hands its keys, attributes or axes in, and a line that books
// another variant or holds another unit binds otherwise.

describe("the stock demand a status change binds", () => {
  let stockDemandOf: typeof import("./reservation-inventory").stockDemandOf;
  before(async () => {
    ({ stockDemandOf } = await import("./reservation-inventory"));
  });

  const line = (overrides: Partial<ReservationDemandLine> = {}): ReservationDemandLine => ({
    line: "line_1",
    product: "suit",
    quantity: 1,
    combinationKey: "size:S|color:red",
    selectedAttributes: { size: "S", color: "red" },
    axes: [
      { key: "size", label: "Size", position: 0 },
      { key: "color", label: "Colour", position: 1 },
    ],
    units: ["unit_b", "unit_a"],
    ...overrides,
  });
  const bound = (lines: ReservationDemandLine[]) => stableStringify(stockDemandOf(lines));

  test("two reads of an unchanged line bind the same, in whatever order its parts come", () => {
    const first = bound([line()]);
    // Keys, attributes and axes in another order; units in another order.
    const reordered = bound([
      {
        units: ["unit_a", "unit_b"],
        axes: [
          { position: 1, label: "Colour", key: "color" },
          { position: 0, label: "Size", key: "size" },
        ],
        selectedAttributes: { color: "red", size: "S" },
        combinationKey: "size:S|color:red",
        quantity: 1,
        product: "suit",
        line: "line_1",
      },
    ]);
    assert.equal(reordered, first);
    // A value written with other blanks is the same choice, as the stock check reads it.
    assert.equal(bound([line({ selectedAttributes: { size: " S ", color: "red" } })]), first);
  });

  test("every field is always there: null for no choice, no combination, no consumable", () => {
    const [none] = stockDemandOf([
      line({ combinationKey: null, selectedAttributes: null, axes: null, units: [] }),
    ]);
    assert.deepEqual(none, {
      line: "line_1",
      product: "suit",
      quantity: 1,
      combinationKey: null,
      choice: null,
      units: [],
      consumable: null,
    });
    // An empty choice, or one on an axis the product no longer has, is no choice.
    assert.equal(
      bound([line({ selectedAttributes: {} })]),
      bound([line({ selectedAttributes: null })]),
    );
    assert.equal(
      bound([line({ selectedAttributes: { size: "S", color: "red", fit: "slim" } })]),
      bound([line()]),
    );
  });

  test("another variant, another unit or another consumable count binds otherwise", () => {
    const first = bound([line()]);
    assert.notEqual(
      bound([
        line({
          combinationKey: "size:L|color:red",
          selectedAttributes: { size: "L", color: "red" },
        }),
      ]),
      first,
    );
    assert.notEqual(bound([line({ units: ["unit_c", "unit_a"] })]), first);
    assert.notEqual(
      bound([line({ consumable: { consumed: 0, takes: 4 } })]),
      bound([line({ consumable: { consumed: 0, takes: 1 } })]),
    );
  });
});

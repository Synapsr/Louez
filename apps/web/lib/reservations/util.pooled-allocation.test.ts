import assert from "node:assert/strict";
import { test } from "node:test";

import { allocateAcrossCombinations } from "./util.pooled-allocation";

const combinations = [
  { combinationKey: "taille:XS", totalQuantity: 1, selectedAttributes: { taille: "XS" } },
  { combinationKey: "taille:S", totalQuantity: 2, selectedAttributes: { taille: "S" } },
];

test("a pooled quantity is spread over several combinations", () => {
  const taken = allocateAcrossCombinations(combinations, () => 0, 2);
  assert.deepEqual(
    [...(taken ?? [])],
    [
      ["taille:XS", 1],
      ["taille:S", 1],
    ],
  );
});

test("units already reserved on a combination are not taken again", () => {
  const reserved = new Map([["taille:XS", 1]]);
  const taken = allocateAcrossCombinations(combinations, (key) => reserved.get(key) ?? 0, 2);
  assert.deepEqual([...(taken ?? [])], [["taille:S", 2]]);
});

test("the allocation fails when the combinations cannot cover the quantity together", () => {
  assert.equal(
    allocateAcrossCombinations(combinations, () => 0, 4),
    null,
  );
});

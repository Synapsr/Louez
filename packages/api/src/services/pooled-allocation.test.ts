import assert from "node:assert/strict";
import { test } from "node:test";

import { spreadAcrossCombinations } from "./pooled-allocation";

const combinations = [
  { combinationKey: "taille:XS", totalQuantity: 1, selectedAttributes: { taille: "XS" } },
  { combinationKey: "taille:S", totalQuantity: 2, selectedAttributes: { taille: "S" } },
];

test("a pooled quantity is spread over several combinations", () => {
  const { taken, missing } = spreadAcrossCombinations(combinations, () => 0, 2);
  assert.deepEqual(
    [...taken],
    [
      ["taille:XS", 1],
      ["taille:S", 1],
    ],
  );
  assert.equal(missing, 0);
});

test("units already reserved on a combination are not taken again", () => {
  const reserved = new Map([["taille:XS", 1]]);
  const { taken, missing } = spreadAcrossCombinations(
    combinations,
    (key) => reserved.get(key) ?? 0,
    2,
  );
  assert.deepEqual([...taken], [["taille:S", 2]]);
  assert.equal(missing, 0);
});

test("what the combinations cannot cover together is reported, with what they gave", () => {
  const { taken, missing } = spreadAcrossCombinations(combinations, () => 0, 4);
  assert.deepEqual(
    [...taken],
    [
      ["taille:XS", 1],
      ["taille:S", 2],
    ],
  );
  assert.equal(missing, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { bookedChoiceOf, openChoiceOf, toInventoryLine } from "./util.booked-choice";

const helmet = {
  trackUnits: true,
  bookingAttributeAxes: [{ key: "taille", label: "Taille", position: 0 }],
};
const line = { productId: "helmet", quantity: 1 };

test("a helmet added without a size books none, and no size is recorded", () => {
  // What the checkout resolved for it (the first size free) is not the customer's choice.
  const item = { ...line, resolvedCombinationKey: "taille:L", resolvedAttributes: { taille: "L" } };
  const open = openChoiceOf(item, helmet);

  assert.deepEqual(open, { combinationKey: null, selectedAttributes: null });
  assert.deepEqual(toInventoryLine(item, open), {
    ...item,
    selectedAttributes: undefined,
    combinationKey: null,
    pooled: true,
  });
  assert.deepEqual(
    bookedChoiceOf(item, open, { combinationKey: "__default", selectedAttributes: {} }),
    { combinationKey: null, selectedAttributes: null },
  );
});

test("a chosen size books its combination, as the stock check resolved it", () => {
  const item = { ...line, selectedAttributes: { taille: "M" } };
  const open = openChoiceOf(item, helmet);

  assert.equal(open, null);
  assert.equal(toInventoryLine(item, open), item);
  assert.deepEqual(
    bookedChoiceOf(item, open, { combinationKey: "taille:M", selectedAttributes: { taille: "M" } }),
    { combinationKey: "taille:M", selectedAttributes: { taille: "M" } },
  );
});

test("a partial choice keeps the values chosen and leaves the rest open", () => {
  const bike = {
    trackUnits: true,
    bookingAttributeAxes: [
      { key: "cadre", label: "Cadre", position: 0 },
      { key: "couleur", label: "Couleur", position: 1 },
    ],
  };
  const item = { ...line, selectedAttributes: { couleur: "Bleu" } };

  assert.deepEqual(openChoiceOf(item, bike), {
    combinationKey: null,
    selectedAttributes: { couleur: "Bleu" },
  });
});

test("a product counted by quantity, or sold without options, is never open", () => {
  assert.equal(openChoiceOf(line, { ...helmet, trackUnits: false }), null);
  assert.equal(openChoiceOf(line, { trackUnits: true, bookingAttributeAxes: [] }), null);
  assert.equal(openChoiceOf(line, undefined), null);
});

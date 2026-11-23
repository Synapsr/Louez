import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mock, test } from "node:test";

import type { BookingAttributeAxis, CombinationAvailability } from "@louez/types";

// @louez/utils is a CommonJS workspace package: its named exports are not
// statically visible to the ESM loader, so hand them over through require.
const require = createRequire(import.meta.url);
const variantUtils: Record<string, unknown> = require("@louez/utils");

mock.module("@louez/utils", { namedExports: variantUtils });
mock.module("@louez/db", {
  namedExports: {
    buildReservationAvailabilityPredicate: () => undefined,
    buildReservationOverlapPredicate: () => undefined,
    getReservationAvailabilityEnd: (reservation: { endDate: Date }) => reservation.endDate,
    buildUnitRentableDuringPredicate: () => undefined,
    db: {},
    getBlockingReservationStatuses: () => ["pending", "confirmed", "ongoing"],
    loadConsumableReservedQuantities: async () => new Map(),
    productAccessories: {},
    productUnitDowntimes: {},
    productUnits: {},
    products: {},
    reservations: {},
    stores: {},
  },
});

const { pickDeterministicCombination, resolveLineCombination } =
  await import("./combination-resolver");

const axes: BookingAttributeAxis[] = [
  { key: "size", label: "Size", position: 0 },
  { key: "color", label: "Color", position: 1 },
];

const combination = (
  overrides: Partial<CombinationAvailability> & Pick<CombinationAvailability, "combinationKey">,
): CombinationAvailability => ({
  selectedAttributes: {},
  totalQuantity: 2,
  reservedQuantity: 0,
  availableQuantity: 2,
  status: "available",
  ...overrides,
});

const combinations = [
  combination({
    combinationKey: "size=M|color=blue",
    selectedAttributes: { size: "M", color: "blue" },
    availableQuantity: 1,
  }),
  combination({
    combinationKey: "size=S|color=red",
    selectedAttributes: { size: "S", color: "red" },
    availableQuantity: 2,
  }),
  combination({
    combinationKey: "size=S|color=blue",
    selectedAttributes: { size: "S", color: "blue" },
    availableQuantity: 0,
    status: "unavailable",
  }),
];

const trackedAvailability = {
  productId: "p1",
  totalQuantity: 5,
  reservedQuantity: 2,
  availableQuantity: 3,
  status: "limited" as const,
  combinations,
};

test("picks the first combination in axis order that holds the quantity", () => {
  const picked = pickDeterministicCombination({
    combinations,
    bookingAxes: axes,
    quantity: 2,
  });

  assert.equal(picked?.combinationKey, "size=S|color=red");
});

test("honours a partial attribute selection", () => {
  const picked = pickDeterministicCombination({
    combinations,
    bookingAxes: axes,
    quantity: 1,
    selectedAttributes: { color: "blue" },
  });

  assert.equal(picked?.combinationKey, "size=M|color=blue");
});

test("returns null when no single combination holds the quantity", () => {
  assert.equal(
    pickDeterministicCombination({
      combinations,
      bookingAxes: axes,
      quantity: 3,
    }),
    null,
  );
  assert.equal(
    pickDeterministicCombination({
      combinations: undefined,
      bookingAxes: axes,
      quantity: 1,
    }),
    null,
  );
});

test("resolveLineCombination books the default combination for untracked products", () => {
  const resolved = resolveLineCombination({
    product: { trackUnits: false, bookingAttributeAxes: null },
    availability: {
      productId: "p1",
      totalQuantity: null,
      reservedQuantity: 0,
      availableQuantity: null,
      status: "available",
    },
    quantity: 4,
  });

  assert.deepEqual(resolved, {
    combinationKey: "__default",
    selectedAttributes: {},
    availableQuantity: null,
  });
});

test("resolveLineCombination books the chosen combination for tracked products", () => {
  const resolved = resolveLineCombination({
    product: { trackUnits: true, bookingAttributeAxes: axes },
    availability: trackedAvailability,
    quantity: 1,
    selectedAttributes: { size: "M", color: "blue" },
  });

  assert.deepEqual(resolved, {
    combinationKey: "size=M|color=blue",
    selectedAttributes: { size: "M", color: "blue" },
    availableQuantity: 1,
  });
});

test("resolveLineCombination leaves an unchosen size open instead of picking one", () => {
  const resolved = resolveLineCombination({
    product: { trackUnits: true, bookingAttributeAxes: axes },
    availability: trackedAvailability,
    quantity: 3,
  });

  // M blue and S red hold three between them: no single one does.
  assert.deepEqual(resolved, {
    combinationKey: "__default",
    selectedAttributes: {},
    availableQuantity: 3,
  });
});

test("resolveLineCombination keeps a partial choice as it was made", () => {
  const resolved = resolveLineCombination({
    product: { trackUnits: true, bookingAttributeAxes: axes },
    availability: trackedAvailability,
    quantity: 2,
    selectedAttributes: { size: "S" },
  });

  assert.deepEqual(resolved, {
    combinationKey: "__default",
    selectedAttributes: { size: "S" },
    availableQuantity: 2,
  });
});

test("resolveLineCombination refuses an open line the matching combinations cannot hold", () => {
  const resolved = resolveLineCombination({
    product: { trackUnits: true, bookingAttributeAxes: axes },
    availability: trackedAvailability,
    quantity: 2,
    selectedAttributes: { color: "blue" },
  });

  assert.equal(resolved, null);
});

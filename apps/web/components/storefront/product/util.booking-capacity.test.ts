import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BookingAttributeAxis, CombinationAvailability } from "@louez/types";

import { clampBookingQuantity, resolveBookingCapacity } from "./util.booking-capacity";

const axes: BookingAttributeAxis[] = [
  { key: "size", label: "Taille", position: 0 },
  { key: "color", label: "Couleur", position: 1 },
];

const combination = (
  selectedAttributes: Record<string, string>,
  availableQuantity: number,
): CombinationAvailability => ({
  combinationKey: Object.values(selectedAttributes).join("|"),
  selectedAttributes,
  availableQuantity,
  totalQuantity: availableQuantity,
  reservedQuantity: 0,
  status: availableQuantity > 0 ? "available" : "unavailable",
});

const combinations = [
  combination({ size: "M", color: "red" }, 2),
  combination({ size: "M", color: "blue" }, 1),
  combination({ size: "L", color: "red" }, 0),
];

describe("resolveBookingCapacity", () => {
  test("without axes, today's stock bounds the quantity until the period answers", () => {
    assert.deepEqual(
      resolveBookingCapacity({
        baseMaxQuantity: 5,
        periodMaxQuantity: undefined,
        axes: [],
        combinations: [],
        selectedAttributes: {},
      }),
      { maxQuantity: 5, allocationMode: "single", isSelectionUnavailable: false },
    );
  });

  test("without axes, the period stock replaces today's once known", () => {
    const capacity = resolveBookingCapacity({
      baseMaxQuantity: 5,
      periodMaxQuantity: 0,
      axes: [],
      combinations: [],
      selectedAttributes: {},
    });
    assert.equal(capacity.maxQuantity, 0);
    assert.equal(capacity.isSelectionUnavailable, true);
  });

  test("untracked stock stays unlimited", () => {
    assert.equal(
      resolveBookingCapacity({
        baseMaxQuantity: null,
        periodMaxQuantity: null,
        axes: [],
        combinations: [],
        selectedAttributes: {},
      }).maxQuantity,
      null,
    );
  });

  test("a full selection is bounded by its single combination", () => {
    assert.deepEqual(
      resolveBookingCapacity({
        baseMaxQuantity: 10,
        periodMaxQuantity: undefined,
        axes,
        combinations,
        selectedAttributes: { size: "M", color: "blue" },
      }),
      { maxQuantity: 1, allocationMode: "single", isSelectionUnavailable: false },
    );
  });

  test("a partial selection adds the matching combinations and splits", () => {
    assert.deepEqual(
      resolveBookingCapacity({
        baseMaxQuantity: 10,
        periodMaxQuantity: undefined,
        axes,
        combinations,
        selectedAttributes: { size: "M" },
      }),
      { maxQuantity: 3, allocationMode: "split", isSelectionUnavailable: false },
    );
  });

  test("the period stock still caps a selection", () => {
    assert.equal(
      resolveBookingCapacity({
        baseMaxQuantity: 10,
        periodMaxQuantity: 2,
        axes,
        combinations,
        selectedAttributes: {},
      }).maxQuantity,
      2,
    );
  });

  test("a selection with no stock is unavailable", () => {
    const capacity = resolveBookingCapacity({
      baseMaxQuantity: 10,
      periodMaxQuantity: undefined,
      axes,
      combinations,
      selectedAttributes: { size: "L" },
    });
    assert.equal(capacity.maxQuantity, 0);
    assert.equal(capacity.isSelectionUnavailable, true);
  });
});

describe("clampBookingQuantity", () => {
  test("keeps the quantity between 1 and the max", () => {
    assert.equal(clampBookingQuantity(0, 3), 1);
    assert.equal(clampBookingQuantity(7, 3), 3);
    assert.equal(clampBookingQuantity(2.7, 3), 2);
  });

  test("an unlimited max only enforces the floor", () => {
    assert.equal(clampBookingQuantity(0, null), 1);
    assert.equal(clampBookingQuantity(42, null), 42);
  });

  test("a max of zero still yields 1 so the stepper never shows 0", () => {
    assert.equal(clampBookingQuantity(4, 0), 1);
  });
});

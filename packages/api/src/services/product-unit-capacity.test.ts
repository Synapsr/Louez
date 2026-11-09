import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// @louez/utils is a CommonJS workspace package: its named exports are not
// statically visible to the ESM loader, so read it through require.
const { DEFAULT_COMBINATION_KEY } = createRequire(import.meta.url)("@louez/utils") as {
  DEFAULT_COMBINATION_KEY: string;
};

import {
  type TrackedUnitCapacityReservation,
  hasTrackedUnitCapacityConflict,
  shouldValidateTrackedUnitCapacity,
} from "./product-unit-capacity";

const now = new Date("2026-07-29T08:00:00.000Z");

test("skips capacity validation when an unrelated product edit preserves unit capacity", () => {
  assert.equal(
    shouldValidateTrackedUnitCapacity({
      wasTrackingUnits: true,
      currentAvailableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 2],
      ]),
      proposedAvailableByCombination: new Map([
        ["color:blue", 2],
        ["color:red", 1],
      ]),
    }),
    false,
  );
});

test("validates capacity when tracked-unit distribution changes", () => {
  assert.equal(
    shouldValidateTrackedUnitCapacity({
      wasTrackingUnits: true,
      currentAvailableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 2],
      ]),
      proposedAvailableByCombination: new Map([
        ["color:red", 2],
        ["color:blue", 1],
      ]),
    }),
    true,
  );
});

test("validates capacity when unit tracking is enabled", () => {
  assert.equal(
    shouldValidateTrackedUnitCapacity({
      wasTrackingUnits: false,
      currentAvailableByCombination: new Map(),
      proposedAvailableByCombination: new Map([[DEFAULT_COMBINATION_KEY, 1]]),
    }),
    true,
  );
});

function reservation({
  start,
  end,
  quantity = 1,
  combinationKey = null,
}: {
  start: string;
  end: string;
  quantity?: number;
  combinationKey?: string | null;
}): TrackedUnitCapacityReservation {
  return {
    startDate: new Date(start),
    endDate: new Date(end),
    combinationKey,
    quantity,
  };
}

test("allows sequential legacy reservations to reuse the same tracked unit", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-07-31T08:00:00.000Z",
    }),
    reservation({
      start: "2026-08-02T08:00:00.000Z",
      end: "2026-08-03T08:00:00.000Z",
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([[DEFAULT_COMBINATION_KEY, 1]]),
      reservations,
      from: now,
    }),
    false,
  );
});

test("blocks overlapping legacy reservations above total capacity", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
    }),
    reservation({
      start: "2026-07-31T08:00:00.000Z",
      end: "2026-08-03T08:00:00.000Z",
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([[DEFAULT_COMBINATION_KEY, 1]]),
      reservations,
      from: now,
    }),
    true,
  );
});

test("allows legacy reservations to use capacity across new combinations", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
      quantity: 2,
      combinationKey: null,
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 1],
      ]),
      reservations,
      from: now,
    }),
    false,
  );
});

test("blocks a specific combination whose concurrent demand exceeds its capacity", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
      quantity: 2,
      combinationKey: "color:red",
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 1],
      ]),
      reservations,
      from: now,
    }),
    true,
  );
});

test("keeps explicit default-combination reservations tied to default units", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
      combinationKey: DEFAULT_COMBINATION_KEY,
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 1],
      ]),
      reservations,
      from: now,
    }),
    true,
  );
});

test("allows generic demand to use capacity left by a specific combination", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
      combinationKey: "color:red",
    }),
    reservation({
      start: "2026-07-31T08:00:00.000Z",
      end: "2026-08-01T08:00:00.000Z",
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 1],
      ]),
      reservations,
      from: now,
    }),
    false,
  );
});

test("blocks combined generic and specific demand above total capacity", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
      combinationKey: "color:red",
    }),
    reservation({
      start: "2026-07-31T08:00:00.000Z",
      end: "2026-08-01T08:00:00.000Z",
      quantity: 2,
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([
        ["color:red", 1],
        ["color:blue", 1],
      ]),
      reservations,
      from: now,
    }),
    true,
  );
});

test("treats a reservation ending when another starts as non-overlapping", () => {
  const reservations = [
    reservation({
      start: "2026-07-30T08:00:00.000Z",
      end: "2026-08-01T08:00:00.000Z",
    }),
    reservation({
      start: "2026-08-01T08:00:00.000Z",
      end: "2026-08-02T08:00:00.000Z",
    }),
  ];

  assert.equal(
    hasTrackedUnitCapacityConflict({
      availableByCombination: new Map([[DEFAULT_COMBINATION_KEY, 1]]),
      reservations,
      from: now,
    }),
    false,
  );
});

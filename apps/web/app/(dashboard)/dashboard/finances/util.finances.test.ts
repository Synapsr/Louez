import assert from "node:assert/strict";
import { test } from "node:test";

import type { FinanceMovement } from "@louez/validations";

import {
  formatSignedAmount,
  getHoldExpiry,
  getOutstandingAge,
  groupMovementsByDay,
  hasActiveFilters,
  isSameInput,
  toMovementsInput,
  toPeriodInput,
  type FinanceSearchState,
} from "./util.finances";

const state = (overrides: Partial<FinanceSearchState> = {}): FinanceSearchState => ({
  period: "month",
  from: null,
  to: null,
  tab: "movements",
  direction: null,
  method: null,
  nature: null,
  status: null,
  min: null,
  max: null,
  q: null,
  page: 1,
  pageSize: 25,
  movement: null,
  ...overrides,
});

const movement = (id: string, dayKey: string, amount: number): FinanceMovement => ({
  id,
  date: new Date(`${dayKey}T10:00:00Z`),
  dayKey,
  reservationId: "r",
  reservationNumber: "R-1",
  customerName: "Thomas Lefèvre",
  nature: "rental",
  method: "cash",
  status: "settled",
  direction: amount < 0 ? "out" : "in",
  amount,
  counted: true,
});

test("a custom period only reaches the server with two real days", () => {
  assert.deepEqual(
    toPeriodInput(state({ period: "custom", from: "2026-09-01", to: "2026-09-18" })),
    {
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-18",
    },
  );
  assert.deepEqual(toPeriodInput(state({ period: "custom", from: "2026-09-01" })), {
    period: "custom",
  });
  assert.deepEqual(
    toPeriodInput(state({ period: "today", from: "2026-09-01", to: "2026-09-18" })),
    {
      period: "today",
    },
  );
});

test("URL state becomes the procedure input, junk left out", () => {
  assert.deepEqual(
    toMovementsInput(
      state({ method: "cash", min: 100, max: -5, q: "  caron ", page: 0, pageSize: 50 }),
    ),
    {
      period: "month",
      direction: undefined,
      method: "cash",
      nature: undefined,
      status: undefined,
      minAmount: 100,
      maxAmount: undefined,
      search: "caron",
      page: 1,
      pageSize: 50,
    },
  );
});

test("server data only seeds the input it was fetched for", () => {
  assert.equal(isSameInput(toMovementsInput(state()), toMovementsInput(state())), true);
  assert.equal(
    isSameInput(toMovementsInput(state({ method: "cash" })), toMovementsInput(state())),
    false,
  );
});

test("rows are grouped by day in the order received, each with the day's full net", () => {
  const groups = groupMovementsByDay({
    movements: [
      movement("c", "2026-09-16", 80),
      movement("b", "2026-09-15", -20),
      movement("a", "2026-09-15", 100),
    ],
    days: [
      { key: "2026-09-15", net: 140, moneyIn: 160, moneyOut: 20 },
      { key: "2026-09-16", net: 80, moneyIn: 80, moneyOut: 0 },
    ],
  });

  assert.deepEqual(
    groups.map((group) => [group.key, group.net, group.movements.map((row) => row.id)]),
    [
      ["2026-09-16", 80, ["c"]],
      ["2026-09-15", 140, ["b", "a"]],
    ],
  );
});

test("amounts spell their sign out", () => {
  const formatMoney = (value: number) => `${value.toFixed(2)} €`;
  assert.equal(formatSignedAmount(320, formatMoney), "+ 320.00 €");
  assert.equal(formatSignedAmount(-150, formatMoney), "− 150.00 €");
  assert.equal(formatSignedAmount(0, formatMoney), "0.00 €");
});

test("a balance ages from the day the rental starts, in the store's calendar", () => {
  const now = new Date("2026-09-18T21:30:00Z"); // 23:30 in Paris, still the 18th
  assert.deepEqual(getOutstandingAge(new Date("2026-09-20T08:00:00Z"), now, "Europe/Paris"), {
    kind: "upcoming",
  });
  assert.deepEqual(getOutstandingAge(new Date("2026-09-18T06:00:00Z"), now, "Europe/Paris"), {
    kind: "today",
  });
  assert.deepEqual(getOutstandingAge(new Date("2026-09-01T08:00:00Z"), now, "Europe/Paris"), {
    kind: "days",
    count: 17,
  });
});

test("a hold warns within two days of its expiry", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  assert.deepEqual(getHoldExpiry(null, now), { kind: "unknown" });
  assert.deepEqual(getHoldExpiry(new Date("2026-09-18T11:00:00Z"), now), { kind: "expired" });
  assert.deepEqual(getHoldExpiry(new Date("2026-09-19T18:00:00Z"), now), { kind: "soon", days: 1 });
  assert.deepEqual(getHoldExpiry(new Date("2026-09-18T20:00:00Z"), now), { kind: "soon", days: 0 });
  assert.deepEqual(getHoldExpiry(new Date("2026-09-25T12:00:00Z"), now), { kind: "later" });
});

test("filters are detected wherever they live", () => {
  assert.equal(hasActiveFilters(state()), false);
  assert.equal(hasActiveFilters(state({ q: "  " })), false);
  assert.equal(hasActiveFilters(state({ q: "caron" })), true);
  assert.equal(hasActiveFilters(state({ min: 10 })), true);
  assert.equal(hasActiveFilters(state({ direction: "out" })), true);
});

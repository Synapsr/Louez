import assert from "node:assert/strict";
import { test } from "node:test";

import type { RentalDateDraft } from "./types";
import { getRentalDraftForDay } from "./use-rental-date-core";

const day = (date: number) => new Date(2030, 8, date);
const context = {
  pricingMode: "week",
  minRentalMinutes: 24 * 60,
  advanceNoticeMinutes: 0,
  intervalMinutes: 30,
  timezone: "Europe/Paris",
} as const;
const draft: RentalDateDraft = {
  startDate: day(11),
  endDate: day(18),
  startTime: "16:30",
  endTime: "18:30",
  endIsAuto: false,
  activeField: "end",
};

test("the first return click keeps pickup, then subsequent clicks select a new range", () => {
  for (const date of [15, 20, 18]) {
    const next = getRentalDraftForDay(draft, day(date), context);
    assert.deepEqual(next.startDate, day(11));
    assert.deepEqual(next.endDate, day(date));
    assert.equal(next.startTime, "16:30");
    assert.equal(next.endTime, "18:30");
    assert.equal(next.activeField, null);

    for (const newStart of [10, 22]) {
      const restarted = getRentalDraftForDay(next, day(newStart), context);
      assert.deepEqual(restarted.startDate, day(newStart));
      const completed = getRentalDraftForDay(restarted, day(25), context);
      assert.deepEqual(completed.startDate, day(newStart));
      assert.deepEqual(completed.endDate, day(25));
      assert.equal(completed.startTime, "16:30");
      assert.equal(completed.endTime, "18:30");
    }
  }
});

test("a return before pickup never moves pickup or reverses the range", () => {
  assert.deepEqual(getRentalDraftForDay(draft, day(10), context), draft);
});

test("same-day returns follow the rental rules", () => {
  assert.deepEqual(getRentalDraftForDay(draft, day(11), context), draft);
  const next = getRentalDraftForDay(draft, day(11), {
    ...context,
    pricingMode: "hour",
    minRentalMinutes: 60,
  });
  assert.deepEqual(next.startDate, day(11));
  assert.deepEqual(next.endDate, day(11));
  assert.equal(next.startTime, "16:30");
  assert.equal(next.endTime, "18:30");
});

test("editing pickup preserves a later return, then allows editing return", () => {
  const next = getRentalDraftForDay({ ...draft, activeField: "start" }, day(12), context);
  assert.deepEqual(next.startDate, day(12));
  assert.deepEqual(next.endDate, day(18));
  assert.equal(next.endTime, "18:30");
  const completed = getRentalDraftForDay(next, day(20), context);
  assert.deepEqual(completed.startDate, day(12));
  assert.deepEqual(completed.endDate, day(20));
});

test("moving pickup past return supplies a new valid default return", () => {
  const next = getRentalDraftForDay({ ...draft, activeField: "start" }, day(20), context);
  assert.deepEqual(next.startDate, day(20));
  assert.deepEqual(next.endDate, day(21));
});

test("opening return without dates still allows a complete range", () => {
  const next = getRentalDraftForDay(
    { ...draft, startDate: undefined, endDate: undefined },
    day(12),
    context,
  );
  const completed = getRentalDraftForDay(next, day(20), context);
  assert.deepEqual(completed.startDate, day(12));
  assert.deepEqual(completed.endDate, day(20));
});

test("the general period picker still starts a fresh range in two clicks", () => {
  const next = getRentalDraftForDay({ ...draft, activeField: null }, day(15), context);
  assert.deepEqual(next.startDate, day(15));
  const completed = getRentalDraftForDay(next, day(20), context);
  assert.deepEqual(completed.startDate, day(15));
  assert.deepEqual(completed.endDate, day(20));
});

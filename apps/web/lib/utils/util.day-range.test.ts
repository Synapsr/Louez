import assert from "node:assert/strict";
import { test } from "node:test";

import { enGB, fr } from "date-fns/locale";

import {
  countRangeDays,
  dateToDay,
  dayToDate,
  formatDayRange,
  getSelectableDayBounds,
  isDay,
  orderDayRange,
  shiftDay,
} from "./util.day-range";

test("a day round-trips through the local midnight the calendar works in", () => {
  const date = dayToDate("2026-03-29");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 2);
  assert.equal(date.getDate(), 29);
  assert.equal(dateToDay(date), "2026-03-29");
});

test("only real calendar days are accepted", () => {
  assert.equal(isDay("2026-02-28"), true);
  assert.equal(isDay("2026-02-30"), false);
  assert.equal(isDay("2026-2-3"), false);
  assert.equal(isDay(""), false);
  assert.equal(isDay(null), false);
});

test("a range counts both of its bounds, across a DST change too", () => {
  assert.equal(countRangeDays({ from: "2026-09-18", to: "2026-09-18" }), 1);
  assert.equal(countRangeDays({ from: "2026-03-28", to: "2026-03-30" }), 3);
});

test("the two clicks of a selection are put in order", () => {
  assert.deepEqual(orderDayRange("2026-09-18", "2026-09-02"), {
    from: "2026-09-02",
    to: "2026-09-18",
  });
  assert.deepEqual(orderDayRange("2026-09-02", "2026-09-18"), {
    from: "2026-09-02",
    to: "2026-09-18",
  });
});

test("the label drops the year inside the current one and collapses a single day", () => {
  assert.equal(
    formatDayRange({ from: "2026-09-01", to: "2026-09-18" }, fr, "2026-09-18"),
    "1 sept. → 18 sept.",
  );
  assert.equal(
    formatDayRange({ from: "2026-09-18", to: "2026-09-18" }, fr, "2026-09-18"),
    "18 sept.",
  );
  assert.equal(
    formatDayRange({ from: "2025-12-28", to: "2026-01-03" }, enGB, "2026-09-18"),
    "28 Dec 2025 → 3 Jan 2026",
  );
});

test("days shift on the calendar, across months and DST changes", () => {
  assert.equal(shiftDay("2026-03-28", 2), "2026-03-30");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
});

test("the longest range tightens the selectable days around the first click", () => {
  assert.deepEqual(getSelectableDayBounds({ anchor: null, minDay: "2026-01-01", maxDays: 7 }), {
    earliest: "2026-01-01",
    latest: undefined,
  });
  assert.deepEqual(
    getSelectableDayBounds({
      anchor: "2026-01-03",
      minDay: "2026-01-01",
      maxDay: "2026-12-31",
      maxDays: 7,
    }),
    { earliest: "2026-01-01", latest: "2026-01-09" },
  );
  assert.deepEqual(getSelectableDayBounds({ anchor: "2026-06-15", maxDays: 7 }), {
    earliest: "2026-06-09",
    latest: "2026-06-21",
  });
});

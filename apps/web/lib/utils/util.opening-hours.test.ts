import assert from "node:assert/strict";
import { test } from "node:test";

import type { BusinessHours } from "@louez/types";

import {
  buildOpeningHoursRows,
  buildOpeningHoursSpecification,
  getUpcomingClosures,
} from "./util.opening-hours";

const open = (ranges: [string, string][]) => ({
  isOpen: true,
  ranges: ranges.map(([openTime, closeTime]) => ({ openTime, closeTime })),
});
const closed = { isOpen: false, ranges: [] };

const hours: BusinessHours = {
  enabled: true,
  schedule: {
    0: closed,
    1: open([
      ["09:00", "12:00"],
      ["14:00", "18:00"],
    ]),
    2: open([
      ["09:00", "12:00"],
      ["14:00", "18:00"],
    ]),
    3: open([
      ["09:00", "12:00"],
      ["14:00", "18:00"],
    ]),
    4: open([
      ["09:00", "12:00"],
      ["14:00", "18:00"],
    ]),
    5: open([
      ["09:00", "12:00"],
      ["14:00", "18:00"],
    ]),
    6: open([["10:00", "17:00"]]),
  },
  closurePeriods: [
    { id: "a", name: "Noël", startDate: "2026-12-24", endDate: "2026-12-26" },
    { id: "b", name: "Inventaire", startDate: "2026-01-05", endDate: "2026-01-06" },
    { id: "c", name: "Toussaint", startDate: "2026-11-01", endDate: "2026-11-02" },
  ],
};

test("folds consecutive days with the same hours into one row, Monday first", () => {
  const rows = buildOpeningHoursRows(hours, "fr-FR");
  assert.deepEqual(
    rows.map((row) => [row.days, row.isOpen, row.ranges.length]),
    [
      ["lundi – vendredi", true, 2],
      ["samedi", true, 1],
      ["dimanche", false, 0],
    ],
  );
  assert.equal(rows[0].ranges[0], "9:00 – 12:00");
});

test("returns nothing when hours are not configured", () => {
  assert.deepEqual(buildOpeningHoursRows(undefined, "fr-FR"), []);
  assert.deepEqual(buildOpeningHoursRows({ ...hours, enabled: false }, "fr-FR"), []);
  assert.deepEqual(buildOpeningHoursSpecification(undefined), []);
});

test("groups schema.org specifications by identical range", () => {
  const spec = buildOpeningHoursSpecification(hours);
  assert.deepEqual(spec, [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "09:00",
      closes: "12:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "14:00",
      closes: "18:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Saturday"],
      opens: "10:00",
      closes: "17:00",
    },
  ]);
});

test("lists only closures that are not over, soonest first", () => {
  const upcoming = getUpcomingClosures(hours.closurePeriods, new Date("2026-09-08T10:00:00Z"));
  assert.deepEqual(
    upcoming.map((closure) => closure.name),
    ["Toussaint", "Noël"],
  );
});

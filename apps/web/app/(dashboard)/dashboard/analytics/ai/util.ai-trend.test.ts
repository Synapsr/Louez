import assert from "node:assert/strict";
import { test } from "node:test";

import { percentChange, shareOf, toAiTrendPoints } from "./util.ai-trend";

test("each bucket is labelled at the store's midnight, visits and bookings as the chart's lines", () => {
  const points = toAiTrendPoints(
    {
      granularity: "day",
      timezone: "Europe/Paris",
      series: [
        // 23:00 UTC the day before is midnight in Paris.
        { start: new Date("2026-11-16T23:00:00Z"), visits: 3, bookings: 1 },
        { start: new Date("2026-11-17T23:00:00Z"), visits: 0, bookings: 0 },
      ],
    },
    "fr-FR",
  );
  assert.deepEqual(
    points.map((point) => [point.label, point.visitors, point.pageViews, point.conversions]),
    [
      ["17/11", 3, 3, 1],
      ["18/11", 0, 0, 0],
    ],
  );
});

test("a long period is labelled by month", () => {
  const [point] = toAiTrendPoints(
    {
      granularity: "month",
      timezone: "UTC",
      series: [{ start: new Date("2026-11-01T00:00:00Z"), visits: 1, bookings: 0 }],
    },
    "en-GB",
  );
  assert.equal(point.label, "Nov 26");
});

test("trend and share stay null when there is nothing to compare with", () => {
  assert.equal(percentChange(6, 4), 50);
  assert.equal(percentChange(3, 0), null);
  assert.equal(shareOf(3, 40), 7.5);
  assert.equal(shareOf(0, 0), null);
});

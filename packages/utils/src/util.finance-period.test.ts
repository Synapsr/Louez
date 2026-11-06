import assert from "node:assert/strict";
import { test } from "node:test";

import { getFinanceDayRange, getFinanceGrowth, getFinanceWindow } from "./util.finance-period";

// 18 Sept 2026, 17:00 in Paris (UTC+2).
const now = new Date("2026-09-18T15:00:00Z");
const paris = "Europe/Paris";

test("presets resolve to days of the store's timezone", () => {
  assert.deepEqual(getFinanceDayRange({ period: "today" }, now, paris), {
    period: "today",
    from: "2026-09-18",
    to: "2026-09-18",
  });
  assert.deepEqual(getFinanceDayRange({ period: "yesterday" }, now, paris), {
    period: "yesterday",
    from: "2026-09-17",
    to: "2026-09-17",
  });
  assert.deepEqual(getFinanceDayRange({ period: "7d" }, now, paris), {
    period: "7d",
    from: "2026-09-12",
    to: "2026-09-18",
  });
  assert.deepEqual(getFinanceDayRange({ period: "month" }, now, paris), {
    period: "month",
    from: "2026-09-01",
    to: "2026-09-18",
  });
  assert.deepEqual(getFinanceDayRange({ period: "lastMonth" }, now, paris), {
    period: "lastMonth",
    from: "2026-08-01",
    to: "2026-08-31",
  });
});

test("the store's day wins over the server's: late evening in Auckland is already tomorrow", () => {
  const range = getFinanceDayRange({ period: "today" }, now, "Pacific/Auckland");
  assert.equal(range.from, "2026-09-19");
});

test("a custom range is kept, reordered and capped at a year; garbage falls back to this month", () => {
  assert.deepEqual(
    getFinanceDayRange({ period: "custom", from: "2026-03-02", to: "2026-03-09" }, now, paris),
    { period: "custom", from: "2026-03-02", to: "2026-03-09" },
  );
  assert.deepEqual(
    getFinanceDayRange({ period: "custom", from: "2026-03-09", to: "2026-03-02" }, now, paris),
    { period: "custom", from: "2026-03-09", to: "2026-03-09" },
  );
  assert.equal(
    getFinanceDayRange({ period: "custom", from: "2020-01-01", to: "2026-03-02" }, now, paris).from,
    "2025-03-02",
  );
  assert.equal(
    getFinanceDayRange({ period: "custom", from: "nope", to: "2026-13-45" }, now, paris).period,
    "month",
  );
});

test("a running period stops at now and is compared with the same stretch before it", () => {
  const window = getFinanceWindow({ period: "today" }, now, paris);

  assert.equal(window.start.toISOString(), "2026-09-17T22:00:00.000Z");
  assert.equal(window.end.toISOString(), now.toISOString());
  assert.equal(window.previousStart.toISOString(), "2026-09-16T22:00:00.000Z");
  assert.equal(window.previousEnd.toISOString(), "2026-09-17T15:00:00.000Z");
  assert.equal(window.buckets.length, 1);
});

test("a finished period is compared with the whole period before it", () => {
  const window = getFinanceWindow({ period: "lastMonth" }, now, paris);

  assert.equal(window.start.toISOString(), "2026-07-31T22:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-31T22:00:00.000Z");
  assert.equal(window.previousStart.toISOString(), "2026-06-30T22:00:00.000Z");
  assert.equal(window.previousEnd.toISOString(), window.start.toISOString());
  assert.equal(window.granularity, "day");
  assert.equal(window.buckets.length, 31);
  assert.equal(window.buckets[30]?.key, "2026-08-31");
});

test("daily buckets follow the store's midnight across a DST change and never pass now", () => {
  const window = getFinanceWindow(
    { period: "custom", from: "2026-03-28", to: "2026-03-30" },
    now,
    paris,
  );

  assert.deepEqual(
    window.buckets.map((bucket) => [bucket.key, bucket.start.toISOString()]),
    [
      ["2026-03-28", "2026-03-27T23:00:00.000Z"],
      ["2026-03-29", "2026-03-28T23:00:00.000Z"],
      ["2026-03-30", "2026-03-29T22:00:00.000Z"],
    ],
  );

  const running = getFinanceWindow({ period: "month" }, now, paris);
  assert.equal(running.buckets.length, 18);
  assert.equal(running.buckets[17]?.end.toISOString(), now.toISOString());
});

test("long ranges group by month; a range in the future is empty", () => {
  const year = getFinanceWindow(
    { period: "custom", from: "2025-10-15", to: "2026-09-18" },
    now,
    paris,
  );
  assert.equal(year.granularity, "month");
  assert.deepEqual(year.buckets.map((bucket) => bucket.key).slice(0, 3), [
    "2025-10-15",
    "2025-11-01",
    "2025-12-01",
  ]);
  assert.equal(year.buckets.length, 12);

  const future = getFinanceWindow(
    { period: "custom", from: "2027-01-01", to: "2027-01-31" },
    now,
    paris,
  );
  assert.equal(future.buckets.length, 0);
  assert.equal(future.end.getTime(), future.start.getTime());
});

test("an unknown timezone falls back to UTC", () => {
  assert.equal(getFinanceWindow({ period: "today" }, now, "Mars/Olympus").timezone, "UTC");
});

test("growth is undefined when the previous period brought nothing", () => {
  assert.equal(getFinanceGrowth(120, 100), 20);
  assert.equal(getFinanceGrowth(50, 0), null);
  assert.equal(getFinanceGrowth(0, 0), 0);
});

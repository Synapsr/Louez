import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateSeasonalAwarePrice } from "./seasonal";

const daily = {
  basePrice: 25,
  basePeriodMinutes: 1440,
  deposit: 100,
  pricingMode: "day",
  enforceStrictTiers: false,
  tiers: [],
  rates: [],
} satisfies Parameters<typeof calculateSeasonalAwarePrice>[0];
const summer = [
  {
    id: "summer",
    name: "Summer",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    basePrice: 40,
    tiers: [],
    rates: [],
  },
];
const date = (day: number, hour = 0) => new Date(2026, 5, day, hour);

test("full days retain their respective seasonal prices and one deposit", () => {
  const result = calculateSeasonalAwarePrice(daily, summer, date(30), date(32), 2);
  assert.deepEqual(
    result.segments.map((s) => s.subtotal),
    [50, 80],
  );
  assert.equal(result.subtotal, 130);
  assert.equal(result.deposit, 200);
  assert.equal(result.total, 330);
  assert.equal(result.savings, 0);
});

test("a season boundary does not charge two daily minimums for a 24h rental", () => {
  const result = calculateSeasonalAwarePrice(daily, summer, date(30, 12), date(31, 12), 1);
  assert.equal(result.subtotal, 32.5);
  assert.deepEqual(
    result.segments.map((s) => s.subtotal),
    [12.5, 20],
  );
  assert.equal(result.originalSubtotal, result.subtotal);
});

test("a short rental has one weighted minimum", () => {
  const result = calculateSeasonalAwarePrice(daily, summer, date(30, 18), date(31, 6), 1);
  assert.equal(result.subtotal, 32.5);
});

test("return at the season boundary excludes the next season", () => {
  const result = calculateSeasonalAwarePrice(daily, summer, date(30, 12), date(31), 1);
  assert.equal(result.subtotal, 25);
  assert.equal(result.segments.length, 1);
  assert.equal(result.isSeasonal, false);
});

test("return at the end of a season excludes the next base period", () => {
  const result = calculateSeasonalAwarePrice(
    daily,
    summer,
    new Date(2026, 6, 31, 12),
    new Date(2026, 7, 1),
    1,
  );
  assert.equal(result.subtotal, 40);
  assert.equal(result.segments.length, 1);
});

test("strict billing remains strict within a season", () => {
  const result = calculateSeasonalAwarePrice(
    { ...daily, enforceStrictTiers: true },
    summer,
    date(31),
    date(32, 12),
    1,
  );
  assert.equal(result.subtotal, 80);
});

test("strict billing rounds the whole rental before seasonal allocation", () => {
  const result = calculateSeasonalAwarePrice(
    { ...daily, enforceStrictTiers: true },
    summer,
    date(30, 12),
    date(32),
    1,
  );
  assert.equal(result.subtotal, 70);
  assert.deepEqual(
    result.segments.map((s) => s.subtotal),
    [16.67, 53.33],
  );
});

test("duration tiers use the entire rental across seasons", () => {
  const rates = [{ id: "week", period: 10080, price: 140, displayOrder: 0 }];
  const seasons = [{ ...summer[0], rates: [{ ...rates[0], price: 210 }] }];
  const result = calculateSeasonalAwarePrice({ ...daily, rates }, seasons, date(29), date(36), 1);
  assert.equal(result.subtotal, 190);
  assert.deepEqual(
    result.segments.map((s) => s.subtotal),
    [40, 150],
  );
});

test("unchanged seasonal grids cannot change the total price", () => {
  for (const strict of [false, true]) {
    for (const basePeriodMinutes of [60, 1440, 10080]) {
      const product = { ...daily, basePeriodMinutes, enforceStrictTiers: strict };
      const seasons = [{ ...summer[0], basePrice: 25 }];
      for (const quantity of [1, 3]) {
        const result = calculateSeasonalAwarePrice(
          product,
          seasons,
          date(30, 17),
          date(32, 10),
          quantity,
        );
        const reference = calculateSeasonalAwarePrice(
          product,
          [],
          date(30, 17),
          date(32, 10),
          quantity,
        );
        assert.equal(result.subtotal, reference.subtotal);
        assert.equal(
          Math.round(result.segments.reduce((sum, s) => sum + s.subtotal, 0) * 100),
          Math.round(result.subtotal * 100),
        );
      }
    }
  }
});

test("legacy tiers use the whole duration without repeating rounded periods", () => {
  const product = {
    ...daily,
    basePeriodMinutes: null,
    tiers: [{ id: "long", minDuration: 3, discountPercent: 20, displayOrder: 0 }],
  };
  const seasons = [{ ...summer[0], tiers: product.tiers }];
  const result = calculateSeasonalAwarePrice(product, seasons, date(30, 12), date(33, 12), 1);
  assert.equal(result.subtotal, 90);
  assert.equal(result.originalSubtotal, 112.5);
});

test("seasons begin at store midnight independently of the runtime timezone", () => {
  const result = calculateSeasonalAwarePrice(
    { ...daily, timezone: "Europe/Paris" },
    summer,
    "2026-06-30T10:00:00Z",
    "2026-07-01T10:00:00Z",
    1,
  );
  assert.equal(result.subtotal, 32.5);
  assert.equal(result.segments[0].endDate.toISOString(), "2026-06-30T22:00:00.000Z");
  assert.equal(result.segments[1].startDate.toISOString(), "2026-06-30T22:00:00.000Z");
});

test("store midnight at return never adds a zero-duration season", () => {
  const result = calculateSeasonalAwarePrice(
    { ...daily, timezone: "America/New_York" },
    summer,
    "2026-06-30T16:00:00Z",
    "2026-07-01T04:00:00Z",
    1,
  );
  assert.equal(result.subtotal, 25);
  assert.equal(result.segments.length, 1);
});

test("daylight saving boundaries use actual elapsed time and contiguous segments", () => {
  const seasons = [{ ...summer[0], startDate: "2026-03-29", endDate: "2026-03-29" }];
  const start = "2026-03-28T23:00:00Z";
  const end = "2026-03-30T22:00:00Z";
  const result = calculateSeasonalAwarePrice(
    { ...daily, timezone: "Europe/Paris" },
    seasons,
    start,
    end,
    1,
  );
  assert.deepEqual(
    result.segments.map((s) => s.durationMinutes),
    [1380, 1440],
  );
  assert.equal(
    result.segments[0].endDate.toISOString(),
    result.segments[1].startDate.toISOString(),
  );
  assert.equal(result.segments.at(-1)?.endDate.toISOString(), new Date(end).toISOString());
});

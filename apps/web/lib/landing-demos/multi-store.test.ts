import assert from "node:assert/strict";
import test from "node:test";

import { subDays } from "date-fns";

import { locales } from "@/i18n/config";
import type { Period } from "@/lib/dashboard/multi-store-metrics";
import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import { createDemoMultiStoreData, DEMO_MULTI_STORES } from "@/lib/landing-demos/multi-store";
import { getDemoToday } from "@/lib/landing-demos/reservations";

const periods: { value: Period; days: number }[] = [
  { value: "7d", days: 7 },
  { value: "30d", days: 30 },
  { value: "90d", days: 90 },
  { value: "6m", days: 180 },
  { value: "12m", days: 365 },
];

test("every period reconciles rental revenue, reservations and customers across the real views", () => {
  const period = createDemoPeriod();
  for (const selection of periods) {
    const fixtures = createDemoMultiStoreData(period, selection.value, "fr");
    assert.equal(fixtures.data.length, selection.days);
    assert.equal(new Set(fixtures.data.map((row) => row.date)).size, selection.days);
    assert.equal(fixtures.metrics.storeCount, 3);
    assert.deepEqual(
      fixtures.storeNames,
      DEMO_MULTI_STORES.map((store) => store.name),
    );
    assert.equal(
      fixtures.metrics.totalRevenue,
      fixtures.performance.reduce((sum, store) => sum + store.revenue, 0),
    );
    assert.equal(
      fixtures.metrics.totalReservations,
      fixtures.performance.reduce((sum, store) => sum + store.reservations, 0),
    );
    assert.equal(
      fixtures.metrics.pendingReservations,
      fixtures.performance.reduce((sum, store) => sum + store.pendingReservations, 0),
    );
    assert.equal(
      fixtures.metrics.totalCustomers,
      fixtures.performance.reduce((sum, store) => sum + store.customers, 0),
    );
    assert.ok(fixtures.metrics.newCustomers <= fixtures.metrics.totalCustomers);
    assert.ok(fixtures.metrics.revenueGrowth > 0);
    assert.equal(fixtures.limits.length, 0);
    for (const store of fixtures.performance) {
      assert.equal(
        store.revenue,
        fixtures.data.reduce((sum, row) => sum + Number(row[store.storeName]), 0),
      );
      assert.ok(store.revenue > 0);
      assert.ok(store.reservations > store.pendingReservations);
    }
  }
});

test("period windows end today in Paris and keep the same rentals on overlapping days", () => {
  const period = createDemoPeriod();
  const week = createDemoMultiStoreData(period, "7d", "fr");
  const month = createDemoMultiStoreData(period, "30d", "fr");
  assert.deepEqual(week.data, month.data.slice(-7));
  assert.ok(month.metrics.totalRevenue > week.metrics.totalRevenue);
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  assert.equal(week.data[0].date, dateFormatter.format(subDays(getDemoToday(period), 6)));
  assert.equal(week.data.at(-1)?.date, dateFormatter.format(getDemoToday(period)));
  const earlier = { start: subDays(period.start, 10), end: subDays(period.end, 10) };
  assert.notEqual(createDemoMultiStoreData(earlier, "7d", "fr").data[0].date, week.data[0].date);
});

test("all eight locales preserve French shop names and amounts while formatting chart dates locally", () => {
  const period = createDemoPeriod();
  const french = createDemoMultiStoreData(period, "30d", "fr");
  for (const locale of locales) {
    const fixtures = createDemoMultiStoreData(period, "30d", locale);
    assert.deepEqual(fixtures.metrics, french.metrics);
    assert.deepEqual(fixtures.performance, french.performance);
    assert.deepEqual(fixtures.storeNames, french.storeNames);
    assert.ok(fixtures.data.every((row) => row.label.length > 0));
  }
});

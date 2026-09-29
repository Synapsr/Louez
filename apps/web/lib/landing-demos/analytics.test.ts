import assert from "node:assert/strict";
import test from "node:test";

import { PERIODS } from "@/app/(dashboard)/dashboard/analytics/period";
import { demo as fleetDemo } from "@/components/landing-demos/features/analytics-fleet.demo";
import { demo as salesDemo } from "@/components/landing-demos/features/analytics-sales.demo";
import { locales } from "@/i18n/config";
import { createDemoAnalytics } from "@/lib/landing-demos/analytics";
import { createDemoPeriod, getDemoProducts } from "@/lib/landing-demos/fixtures";
import { getDemoCustomer, getDemoToday } from "@/lib/landing-demos/reservations";

const rentalPeriod = createDemoPeriod();
const sum = (values: number[]) =>
  Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

test("every period reconciles chart, payment methods and customers to receipts", () => {
  for (const period of PERIODS) {
    const data = createDemoAnalytics(period, "fr", rentalPeriod);
    assert.equal(sum(data.revenue.map((point) => point.revenue)), data.stats.periodRevenue);
    assert.equal(sum(data.methods.map((method) => method.amount)), data.stats.periodRevenue);
    assert.equal(
      sum(data.customers.map((customer) => Number(customer.totalRevenue))),
      data.stats.periodRevenue,
    );
    assert.equal(sum(data.revenue.map((point) => point.payments)), data.stats.periodPaymentCount);
    assert.equal(sum(data.methods.map((method) => method.count)), data.stats.periodPaymentCount);
    assert.equal(
      sum(data.customers.map((customer) => customer.paymentCount)),
      data.stats.periodPaymentCount,
    );
    assert.equal(
      data.stats.avgPaymentValue,
      data.stats.periodRevenue / data.stats.periodPaymentCount,
    );
    assert.equal(data.topProducts.catalogRevenue, data.stats.periodRevenue);
    assert.equal(data.topProducts.totalRevenue, data.stats.periodRevenue);
    assert.equal(data.topProducts.nonCatalogRevenue, 0);
    assert.equal(data.topProducts.unallocatedRevenue, 0);
  }
});

test("period changes use rolling Paris windows and preserve lifetime and upcoming revenue", () => {
  const week = createDemoAnalytics("7d", "fr", rentalPeriod);
  const month = createDemoAnalytics("30d", "fr", rentalPeriod);
  assert.equal(week.revenue.length, 7);
  assert.equal(month.revenue.length, 30);
  assert.deepEqual(week.revenue, month.revenue.slice(-7));
  assert.ok(month.stats.periodRevenue >= 10000 && month.stats.periodRevenue < 30000);
  assert.ok(week.stats.periodRevenue < month.stats.periodRevenue);
  for (const period of PERIODS) {
    const data = createDemoAnalytics(period, "fr", rentalPeriod);
    assert.equal(data.window.timezone, "Europe/Paris");
    assert.equal(data.window.end.getTime(), getDemoToday(rentalPeriod).getTime());
    assert.equal(data.stats.totalRevenue, month.stats.totalRevenue);
    assert.deepEqual(data.upcoming, month.upcoming);
    assert.ok(data.stats.totalRevenue >= data.stats.periodRevenue);
  }
});

test("rankings and occupancy use the rental catalogue and French customers", () => {
  const products = getDemoProducts("fr");
  const data = createDemoAnalytics("30d", "fr", rentalPeriod);
  assert.equal(
    data.occupancy.availableUnits,
    sum(products.map((product) => product.quantity ?? 0)),
  );
  assert.ok(data.occupancy.rate > 0 && data.occupancy.rate <= 100);
  assert.ok(
    data.duration.avgMinutes !== null &&
      data.duration.avgMinutes >= 1440 &&
      data.duration.avgMinutes <= 2880,
  );
  assert.equal(data.duration.reservationCount, data.reservationStats.reservationCount);
  assert.equal(data.reservationStats.reservationCount, data.stats.periodPaymentCount);
  assert.ok(data.topProducts.products.length <= 10);
  let previousRevenue = Infinity;
  for (const row of data.topProducts.products) {
    const product = products.find((product) => product.id === row.productId);
    assert.ok(product);
    assert.equal(row.productName, product.name);
    assert.ok(Number(row.totalRevenue) <= previousRevenue);
    assert.equal(Number(row.totalRevenue) % Number(product.price), 0);
    assert.ok(row.totalQuantity >= row.reservationCount);
    previousRevenue = Number(row.totalRevenue);
  }
  assert.ok(
    sum(data.topProducts.products.map((product) => Number(product.totalRevenue))) <=
      data.topProducts.catalogRevenue,
  );
  for (const customer of data.customers) {
    const expected = Array.from({ length: 6 }, (_, index) => getDemoCustomer(index)).find(
      (entry) => entry.id === customer.customerId,
    );
    assert.ok(expected);
    assert.equal(customer.firstName, expected.firstName);
    assert.equal(customer.lastName, expected.lastName);
  }
});

test("all eight locales translate the catalogue while preserving the same figures", () => {
  const french = createDemoAnalytics("30d", "fr", rentalPeriod);
  for (const locale of locales) {
    const data = createDemoAnalytics("30d", locale, rentalPeriod);
    assert.deepEqual(data.stats, french.stats);
    assert.deepEqual(data.customers, french.customers);
    assert.deepEqual(data.occupancy, french.occupancy);
    const products = getDemoProducts(locale);
    for (const row of data.topProducts.products) {
      assert.equal(row.productName, products.find((product) => product.id === row.productId)?.name);
    }
    assert.equal(data.revenue.length, 30);
    assert.ok(data.revenue.every((point) => point.label.length > 0));
  }
});

test("daily series remain complete across both Paris daylight-saving changes", () => {
  for (const start of ["2026-04-07T07:00:00Z", "2026-11-03T08:00:00Z"]) {
    const period = { start: new Date(start), end: new Date(start) };
    const data = createDemoAnalytics("30d", "en", period);
    assert.equal(data.revenue.length, 30);
    assert.equal(new Set(data.revenue.map((point) => point.label)).size, 30);
    assert.equal(sum(data.revenue.map((point) => point.revenue)), data.stats.periodRevenue);
    assert.ok(data.occupancy.rate > 0 && data.occupancy.rate <= 100);
  }
});

test("analytics scripts move before actions with reading time and stable data selectors", () => {
  for (const demo of [salesDemo, fleetDemo]) {
    assert.equal(demo.actor, "owner");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-[\w-]+(?:="[\w-]+")?\]$/);
      const previous = demo.cues[index - 1];
      if (previous) assert.ok(cue.at > previous.at);
      if (cue.click || cue.hover || cue.scroll) {
        assert.ok(previous);
        assert.equal(previous.selector, cue.selector);
        assert.ok(cue.at - previous.at >= 700 && cue.at - previous.at <= 900);
        assert.ok(!previous.click && !previous.hover && !previous.scroll);
      }
    }
  }
});

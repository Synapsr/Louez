import assert from "node:assert/strict";
import test from "node:test";
import { createDemoPeriod, getDemoCategories } from "./fixtures";
import { getDemoCart } from "./cart";
import { createDemoProductDetail, filterDemoProducts, getDemoProductList } from "./products";
import { getDemoProductsText } from "./text.products";
import { locales } from "@/i18n/config";
import {
  addDays,
  computeDailyAvailability,
  diffInDays,
  placeDowntimes,
  startOfDay,
} from "@/components/dashboard/reservations-timeline/timeline-utils";
import { demo as listDemo } from "@/components/landing-demos/features/products-list.demo";
import { demo as filterDemo } from "@/components/landing-demos/features/products-filter.demo";
import { demo as availabilityDemo } from "@/components/landing-demos/features/product-availability.demo";

const period = createDemoPeriod();
const cart = getDemoCart({ "demo-city-bike": 2 }, period);
assert.ok(cart.booking);
const booking = cart.booking;

test("category filters select localized rows and clear back to all twelve products", () => {
  for (const locale of locales) {
    const products = getDemoProductList(locale);
    assert.equal(products.length, 12);
    for (const category of getDemoCategories(locale)) {
      const filtered = filterDemoProducts(products, {
        categoryIds: [category.id],
        status: "all",
        search: "",
      });
      assert.equal(filtered.length, category.productCount);
      assert.ok(filtered.every((product) => product.category?.id === category.id));
    }
    assert.equal(
      filterDemoProducts(products, { categoryIds: [], status: "all", search: "" }).length,
      12,
    );
    assert.equal(
      filterDemoProducts(products, { categoryIds: [], status: "draft", search: "" }).length,
      0,
    );
    assert.ok(getDemoProductsText(locale).description.length > 20);
  }
});

test("tracked assignments and maintenance never overlap or exceed stock before availability clamping", () => {
  for (const product of getDemoProductList()) {
    const detail = createDemoProductDetail(period, booking, "fr", product.id);
    const { timeline, units } = detail;
    assert.equal(units.length, product.quantity);
    const reservations = timeline.reservations;
    assert.equal(reservations.length, detail.reservationsPage.items.length);
    for (const reservation of reservations) {
      assert.equal(reservation.assignedUnitIds.length, reservation.quantity);
      assert.equal(new Set(reservation.assignedUnitIds).size, reservation.quantity);
      assert.ok(reservation.assignedUnitIds.every((id) => units.some((unit) => unit.id === id)));
    }
    for (let day = -6; day <= 20; day++) {
      const date = startOfDay(addDays(detail.today, day));
      const occupied = reservations
        .filter(
          (reservation) =>
            startOfDay(reservation.startDate) <= date && startOfDay(reservation.endDate) >= date,
        )
        .flatMap((reservation) => reservation.assignedUnitIds);
      const maintenance = timeline.downtimes
        .filter(
          (downtime) =>
            startOfDay(downtime.startsAt) <= date &&
            (!downtime.endsAt || startOfDay(downtime.endsAt) >= date),
        )
        .map((downtime) => downtime.unitId);
      assert.equal(
        new Set([...occupied, ...maintenance]).size,
        occupied.length + maintenance.length,
        `${product.id}: overlapping unit on day ${day}`,
      );
      assert.ok(occupied.length + maintenance.length <= product.quantity);
    }
  }
});

test("availability agrees with inventory and maintenance blocks exactly one lane", () => {
  const detail = createDemoProductDetail(period, booking);
  assert.deepEqual(
    detail.units.map((unit) => unit.identifier),
    Array.from({ length: 8 }, (_, index) => `VDV-0${index + 1}`),
  );
  const windowStart = startOfDay(addDays(detail.today, -5));
  const placedDowntimes = placeDowntimes({
    downtimes: detail.timeline.downtimes,
    lanes: detail.units.map((unit) => ({ key: unit.id, unitId: unit.id, label: unit.identifier })),
    windowStart,
    daysCount: 20,
  });
  const free = computeDailyAvailability({
    reservations: detail.timeline.reservations,
    placedDowntimes,
    totalUnits: 8,
    windowStart,
    daysCount: 20,
  });
  const busy = detail.units.filter((unit) => unit.isBusyToday).length;
  assert.equal(free[diffInDays(windowStart, detail.today)], 8 - busy - 1);
  assert.ok(new Set(free).size > 1);
  assert.ok(free.every((value) => value >= 0 && value <= 8));
  assert.equal(detail.units.filter((unit) => unit.currentDowntime).length, 1);
  assert.equal(
    Object.values(detail.counts).reduce((sum, count) => sum + count, 0),
    detail.revenueStats.reservationCount,
  );
});

test("maximum-stock bookings remain valid and translated details preserve assignments", () => {
  const fullCart = getDemoCart({ "demo-city-bike": 8 }, period);
  assert.ok(fullCart.booking);
  const full = createDemoProductDetail(period, fullCart.booking);
  assert.equal(
    full.timeline.reservations.find((row) => row.id === "demo-reservation-0")?.quantity,
    8,
  );
  const reference = createDemoProductDetail(period, booking);
  for (const locale of locales) {
    const detail = createDemoProductDetail(period, booking, locale);
    assert.deepEqual(
      detail.timeline.reservations.map((row) => [row.id, row.assignedUnitIds]),
      reference.timeline.reservations.map((row) => [row.id, row.assignedUnitIds]),
    );
  }
});

test("scripts are locale independent, bounded and move before every action", () => {
  for (const demo of [listDemo, filterDemo, availabilityDemo]) {
    assert.equal(demo.actor, "owner");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at >= 0 && cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-[a-z-]+(?:="[a-z-]+")?\]$/);
      if (index > 0) assert.ok(cue.at > demo.cues[index - 1].at);
      if (cue.click || cue.press || cue.scroll) {
        const previous = demo.cues[index - 1];
        assert.ok(previous);
        assert.equal(previous.selector, cue.selector);
        assert.ok(!previous.click && !previous.press && !previous.scroll);
        assert.ok(cue.at - previous.at >= 700 && cue.at - previous.at <= 900);
      }
    }
  }
});

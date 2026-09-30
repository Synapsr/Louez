import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerStats } from "@/app/(dashboard)/dashboard/customers/[id]/util.customer-stats";
import { demo as customerDetailDemo } from "@/components/landing-demos/features/customer-detail.demo";
import { demo as customersSearchDemo } from "@/components/landing-demos/features/customers-search.demo";
import { locales } from "@/i18n/config";
import { getDemoCart } from "./cart";
import { createDemoCustomers, filterDemoCustomers } from "./customers";
import { createDemoPeriod } from "./fixtures";
import { createDemoReservationDetail } from "./reservation-detail";
import { createDemoReservationPages, getDemoToday } from "./reservations";
import { getDemoCustomerText } from "./text.customers";

const period = createDemoPeriod();
const cart = getDemoCart({ "demo-city-bike": 2 }, period);
assert.ok(cart.booking);
const booking = cart.booking;

test("customer histories cover the shared bookings once, with totals and reservation handoffs intact in every locale", () => {
  for (const locale of locales) {
    const customers = createDemoCustomers(period, booking, locale);
    const shared = createDemoReservationPages(period, booking, locale, true);
    assert.equal(customers.length, 12);
    assert.equal(new Set(customers.map((record) => record.customer.id)).size, 12);
    assert.equal(
      customers.filter((record) => record.customer.customerType === "business").length,
      2,
    );
    assert.equal(customers.flatMap((record) => record.history).length, shared.rows.length);
    assert.ok(customers[0].history.some((entry) => entry.status === "completed"));

    for (const record of customers) {
      assert.ok(record.customer.createdAt < getDemoToday(period));
      assert.equal(record.customer.city, "Nantes");
      assert.equal(record.listCustomer.reservationCount, record.history.length);
      assert.equal(
        record.listCustomer.totalSpent,
        record.reservations
          .reduce((sum, reservation) => sum + Number(reservation.totalAmount), 0)
          .toFixed(2),
      );
      assert.equal(record.stats.totalReservations, record.reservations.length);
      assert.equal(
        record.stats.completedReservations,
        record.history.filter((entry) => entry.status === "completed").length,
      );
      assert.equal(
        record.stats.avgOrderValue,
        record.reservations.reduce((sum, reservation) => sum + Number(reservation.totalAmount), 0) /
          record.reservations.length,
      );

      for (const entry of record.history) {
        const source = shared.rows[entry.index];
        assert.equal(entry.reservation.id, source.id);
        assert.equal(entry.reservation.totalAmount, source.totalAmount);
        assert.deepEqual(entry.reservation.items, source.items);
        if (entry.period.end < getDemoToday(period)) assert.equal(entry.status, "completed");
        assert.deepEqual(entry.period, entry.booking.period);
        const { reservation } = createDemoReservationDetail(
          entry.booking,
          entry.period,
          entry.index,
          entry.status,
          locale,
        );
        assert.equal(reservation.number, entry.reservation.number);
        assert.equal(reservation.customer.firstName, record.customer.firstName);
        assert.equal(reservation.customer.lastName, record.customer.lastName);
        assert.equal(reservation.totalAmount, entry.reservation.totalAmount);
        assert.deepEqual(
          reservation.items?.map((item) => [item.product?.name, item.quantity]),
          entry.reservation.items.map((item) => [item.product?.name, item.quantity]),
        );
      }
    }
  }
});

test("customer totals retain the product rules for pending, ongoing and completed rentals", () => {
  assert.deepEqual(
    getCustomerStats([
      { status: "completed", totalAmount: "40.00" },
      { status: "ongoing", totalAmount: "60.00" },
      { status: "pending", totalAmount: "80.00" },
    ]),
    { totalReservations: 3, completedReservations: 1, totalSpent: 100, avgOrderValue: 60 },
  );
  assert.deepEqual(getCustomerStats([]), {
    totalReservations: 0,
    completedReservations: 0,
    totalSpent: 0,
    avgOrderValue: 0,
  });
});

test("local customer search, type and sorting preserve fixtures and find the scripted customer", () => {
  const customers = createDemoCustomers(period, booking).map((record) => record.listCustomer);
  const initialOrder = customers.map((customer) => customer.id);
  const filters = { search: "  CAMILLE  ", type: "all", sort: "recent" };
  const results = filterDemoCustomers(customers, filters);
  assert.ok(results.length < customers.length);
  assert.ok(results.some((customer) => customer.id === "demo-customer-0"));
  assert.equal(
    filterDemoCustomers(customers, { ...filters, search: "unknown customer" }).length,
    0,
  );
  assert.equal(
    filterDemoCustomers(customers, { ...filters, search: "", type: "business" }).length,
    2,
  );
  assert.equal(
    filterDemoCustomers(customers, { ...filters, search: "lou.bernard@example.com" })[0]?.id,
    "demo-customer-3",
  );
  const sorted = filterDemoCustomers(customers, { ...filters, search: "", sort: "spent" });
  assert.ok(
    sorted.every(
      (customer, index) =>
        index === 0 || Number(sorted[index - 1].totalSpent) >= Number(customer.totalSpent),
    ),
  );
  assert.deepEqual(
    customers.map((customer) => customer.id),
    initialOrder,
  );
});

test("customer notes cover every locale and cue actions follow their pointer moves", () => {
  for (const locale of locales) {
    assert.ok(getDemoCustomerText(locale).notes.length > 0);
    assert.ok(getDemoCustomerText(locale).businessNotes.length > 0);
  }
  for (const demo of [customerDetailDemo, customersSearchDemo]) {
    assert.equal(demo.actor, "owner");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-/);
      if (index > 0) assert.ok(cue.at > demo.cues[index - 1].at);
      if (cue.click || cue.scroll || cue.type) {
        const move = demo.cues[index - 1];
        assert.equal(cue.selector, move.selector);
        assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
      }
    }
  }
});

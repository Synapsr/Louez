import assert from "node:assert/strict";
import test from "node:test";
import { createDemoReservationDetail } from "./reservation-detail";
import { createDemoReservationPages } from "./reservations";
import type { DemoBooking } from "./fixtures";

const period = { start: new Date("2026-10-10T07:00:00Z"), end: new Date("2026-10-10T16:00:00Z") };
const booking: DemoBooking = { productIndex: 0, quantity: 2, selected: {}, unitPrice: 20, period };

test("the detail page preserves the customer, prices and payment from each selected list row", () => {
  const pages = createDemoReservationPages(period, booking);
  pages.rows.forEach((row, index) => {
    assert.ok(row.status);
    const detail = createDemoReservationDetail(
      pages.bookings[index],
      { start: new Date(row.startDate), end: new Date(row.endDate) },
      index,
      row.status,
    );
    assert.equal(detail.reservation.number, row.number);
    assert.equal(detail.reservation.customer.id, row.customer.id);
    assert.equal(detail.reservation.customer.firstName, row.customer.firstName);
    assert.equal(detail.reservation.totalAmount, row.totalAmount);
    const received = detail.reservation.payments.filter(
      (payment) => payment.type === "rental" && payment.status === "completed",
    );
    assert.deepEqual(
      received.map((payment) => payment.amount),
      row.payments.map((payment) => payment.amount),
    );
    assert.ok(detail.reservation.activity.every((activity) => activity.createdAt <= new Date()));
    assert.ok(detail.invoices.every((invoice) => invoice.totalInclTax === row.totalAmount));
  });
});

test("a pending reservation never claims a received payment, invoice or authorized deposit", () => {
  const detail = createDemoReservationDetail(booking, period, 4, "pending");
  assert.deepEqual(detail.reservation.payments, []);
  assert.deepEqual(detail.invoices, []);
  assert.equal(detail.reservation.depositStatus, "pending");
  assert.equal(detail.reservation.depositAuthorizationExpiresAt, null);
  assert.deepEqual(
    detail.reservation.activity.map((event) => event.activityType),
    ["created"],
  );
});

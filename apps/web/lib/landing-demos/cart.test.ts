import assert from "node:assert/strict";
import test from "node:test";
import { getDemoCart } from "./cart";
import { getDemoReservationItems } from "./fixtures";

const period = {
  start: new Date("2026-09-22T07:00:00Z"),
  end: new Date("2026-09-22T16:00:00Z"),
};

test("all cart lines and totals follow through to the reservation", () => {
  const cart = getDemoCart({ "demo-city-bike": 2, "demo-electric-bike": 1 }, period);
  assert.equal(cart.summary.count, 3);
  assert.equal(cart.summary.total, 75);
  assert.equal(cart.summary.deposit, 600);
  assert.ok(cart.booking);
  const reservation = getDemoReservationItems(cart.booking);
  assert.ok(reservation.items);
  assert.deepEqual(
    reservation.items.map((item) => item.quantity),
    [2, 1],
  );
  assert.equal(Number(reservation.subtotalAmount), cart.summary.total);
  assert.equal(Number(reservation.depositAmount), cart.summary.deposit);
});

test("removing lines, invalid quantities and stock limits cannot inflate the demo cart", () => {
  const cart = getDemoCart(
    { "demo-city-bike": 0, "demo-electric-bike": 99, "demo-child-bike": NaN, unknown: 3 },
    period,
  );
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].quantity, 5);
  assert.equal(cart.summary.total, 175);
  const empty = getDemoCart({}, period);
  assert.equal(empty.summary.count, 0);
  assert.equal(empty.booking, null);
});

test("changing the rental period reprices cart and reservation with the app calculator", () => {
  const cart = getDemoCart(
    { "demo-city-bike": 2 },
    { ...period, end: new Date("2026-09-23T16:00:00Z") },
  );
  assert.equal(cart.summary.total, 55);
  assert.equal(cart.summary.deposit, 300);
  assert.ok(cart.booking);
  assert.equal(Number(getDemoReservationItems(cart.booking).subtotalAmount), 55);
});

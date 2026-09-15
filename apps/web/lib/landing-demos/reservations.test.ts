import assert from "node:assert/strict";
import test from "node:test";
import { dashboardReservationCalendarPeriodEntrySchema } from "@louez/validations";
import { getDemoCart } from "./cart";
import { createDemoReservationPages } from "./reservations";

const period = { start: new Date("2026-09-22T07:00:00Z"), end: new Date("2026-09-22T16:00:00Z") };
test("catalogue bookings retain their products, totals and dates in list, calendar and details", () => {
  const cart = getDemoCart({ "demo-city-bike": 2, "demo-electric-bike": 1 }, period);
  assert.ok(cart.booking);
  const data = createDemoReservationPages(period, cart.booking);
  assert.equal(data.rows.length, 24);
  for (const [index, row] of data.rows.entries()) {
    assert.ok(
      dashboardReservationCalendarPeriodEntrySchema.safeParse(data.calendar[index]).success,
    );
    assert.equal(row.id, data.calendar[index].id);
    assert.equal(row.subtotalAmount, data.calendar[index].subtotalAmount);
    assert.ok(row.endDate > row.startDate);
    assert.equal(row.startDate.getTime(), data.bookings[index].period.start.getTime());
    for (const item of row.items) {
      assert.ok(
        data.products.some(
          (product) => product.id === item.product?.id && product.name === item.product.name,
        ),
      );
    }
  }
  assert.deepEqual(
    data.rows[0].items.map((item) => [item.product?.id, item.quantity]),
    [
      ["demo-city-bike", 2],
      ["demo-electric-bike", 1],
    ],
  );
  assert.equal(data.rows[0].subtotalAmount, "75");
  assert.equal(data.rows[0].depositAmount, "600");
  assert.equal(data.bookings[0], cart.booking);
});

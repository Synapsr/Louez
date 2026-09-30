import assert from "node:assert/strict";
import test from "node:test";

import { dashboardReservationCalendarPeriodEntrySchema } from "@louez/validations";

import { locales } from "@/i18n/config";
import { getDemoCart } from "@/lib/landing-demos/cart";
import { createDemoDeliveryCalendar, DEMO_DELIVERY_STORE } from "@/lib/landing-demos/delivery";
import { createDemoPeriod } from "@/lib/landing-demos/fixtures";
import { createDemoReservationPages, getDemoToday } from "@/lib/landing-demos/reservations";

test("delivery fixtures preserve rental bookings and valid logistics in every locale", () => {
  for (const locale of locales) {
    const period = createDemoPeriod();
    const cart = getDemoCart({ "demo-city-bike": 2 }, period, locale);
    assert.ok(cart.booking);
    const source = createDemoReservationPages(period, cart.booking, locale, true);
    const data = createDemoDeliveryCalendar(period, cart.booking, locale);

    assert.equal(data.calendar.length, source.calendar.length);
    assert.equal(new Set(data.calendar.map(({ id }) => id)).size, data.calendar.length);
    assert.deepEqual(data.bookings, source.bookings);
    assert.deepEqual(data.products, source.products);
    for (const [index, reservation] of data.calendar.entries()) {
      assert.ok(dashboardReservationCalendarPeriodEntrySchema.safeParse(reservation).success);
      assert.equal(reservation.startDate.getTime(), source.calendar[index].startDate.getTime());
      assert.equal(reservation.endDate.getTime(), source.calendar[index].endDate.getTime());
      assert.equal(reservation.totalAmount, source.calendar[index].totalAmount);
      assert.deepEqual(reservation.customer, source.calendar[index].customer);
      assert.deepEqual(reservation.items, source.calendar[index].items);
    }
    assert.equal(
      data.calendar.filter(({ outboundMethod }) => outboundMethod === "address").length,
      3,
    );
    assert.equal(data.calendar.filter(({ returnMethod }) => returnMethod === "address").length, 2);
    assert.ok(data.calendar.some(({ outboundMethod }) => outboundMethod === "pickup"));
  }
});

test("scripted delivery and collection stay around today as the dates roll forward", () => {
  for (const dayOffset of [0, 1, 6, 15, 45, 190, 365]) {
    const period = createDemoPeriod();
    period.start.setDate(period.start.getDate() + dayOffset);
    period.end.setDate(period.end.getDate() + dayOffset);
    const cart = getDemoCart({ "demo-city-bike": 2 }, period);
    assert.ok(cart.booking);
    const data = createDemoDeliveryCalendar(period, cart.booking);
    const today = getDemoToday(period);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const delivery = data.calendar.find(({ id }) => id === "demo-delivery-outbound");
    const returning = data.calendar.find(({ id }) => id === "demo-delivery-return");

    assert.ok(delivery);
    assert.ok(returning);
    assert.ok(delivery.startDate >= today && delivery.startDate <= tomorrow);
    assert.equal(returning.endDate.toDateString(), today.toDateString());
    assert.equal(returning.status, "ongoing");
    assert.equal(delivery.deliveryCity, "Nantes");
    assert.equal(returning.returnAddress, returning.deliveryAddress);
    assert.equal(returning.returnCountry, "FR");
  }
});

test("the simulator fixture supports a calculated fee, a minimum and free delivery", () => {
  const { delivery } = DEMO_DELIVERY_STORE.settings;
  assert.equal(delivery.mode, "optional");
  assert.ok(20 * delivery.pricePerKm > delivery.minimumFee);
  assert.ok(3 * delivery.pricePerKm < delivery.minimumFee);
  assert.ok(250 >= delivery.freeDeliveryThreshold);
  assert.ok(20 <= delivery.maximumDistance);
});

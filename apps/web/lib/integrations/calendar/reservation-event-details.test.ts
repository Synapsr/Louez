import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  buildReservationCalendarEventDetails,
  getCalendarCustomerName,
  getCalendarRoomNames,
  getReservationCalendarTitle,
} from "./reservation-event-details";

describe("reservation-event-details", () => {
  const customer = {
    customerType: "individual" as const,
    firstName: "Ada",
    lastName: "Lovelace",
    companyName: "Ignored for individual clients",
    email: "ada@example.com",
    phone: null,
  };
  const startDate = new Date("2026-11-20T09:00:00.000Z");
  const endDate = new Date("2026-11-20T12:00:00.000Z");

  test("uses internal title first, then business name, then reservation number", () => {
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: "  Private event  ",
        number: "R-100",
        customer,
      }),
      "Private event",
    );
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: null,
        number: "R-101",
        customer: { ...customer, customerType: "business", companyName: "  Example Ltd " },
      }),
      "Example Ltd",
    );
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: " ",
        number: "R-102",
        customer,
      }),
      "R-102",
    );
  });

  test("uses company or individual identity according to customer type", () => {
    assert.equal(getCalendarCustomerName(customer), "Ada Lovelace");
    assert.equal(
      getCalendarCustomerName({
        ...customer,
        customerType: "business",
        companyName: "Example Ltd",
      }),
      "Example Ltd",
    );
  });

  test("includes room products from any category and known studio names", () => {
    assert.deepEqual(
      getCalendarRoomNames([
        {
          name: "Meeting room",
          quantity: 1,
          categories: [{ name: "Pomieszczenia", slug: "pomieszczenia" }],
        },
        {
          name: "Camera",
          quantity: 1,
          category: { name: "Cameras", slug: "cameras" },
        },
        { name: "Studio Foto", quantity: 2 },
      ]),
      ["Meeting room", "Studio Foto (x2)"],
    );
  });

  test("builds title, event time, and room details", () => {
    const details = buildReservationCalendarEventDetails({
      reservation: {
        internalTitle: null,
        number: "R-103",
        startDate,
        endDate,
        totalAmount: "125.00",
        customerNotes: null,
        customer,
      },
      store: { name: "Rental store", address: null },
      productNames: "Camera, Studio (x2)",
      roomNames: ["Studio (x2)"],
      statusLabel: "[OK]",
      reservationUrl: "https://example.com/dashboard/reservations/R-103",
    });

    assert.equal(details.summary, "R-103");
    assert.equal(details.startDate, startDate);
    assert.equal(details.endDate, endDate);
    assert.match(details.description, /Guest: Ada Lovelace/);
    assert.match(details.description, /Statut: \[OK\]/);
    assert.match(details.description, /ROOMS\nStudio \(x2\)/);
    assert.doesNotMatch(details.description, /Ignored for individual clients/);
  });
});

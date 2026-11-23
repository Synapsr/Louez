import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  buildReservationCalendarEventDetails,
  getCalendarCustomerName,
  getCalendarReservationStatusLabel,
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
    phone: "+48 123 456 789",
  };
  const startDate = new Date("2026-11-20T09:00:00.000Z");
  const endDate = new Date("2026-11-20T12:00:00.000Z");

  test("formats the customer, readable reservation number, and optional internal title", () => {
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: " test reservation ",
        number: "2026-0000",
        customer: {
          ...customer,
          customerType: "business",
          companyName: "Business",
        },
      }),
      "Business, #2026-0000, (test reservation)",
    );
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: null,
        number: "R-101",
        customer: { ...customer, customerType: "business", companyName: "  Example Ltd " },
      }),
      "Example Ltd, #R-101",
    );
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: null,
        number: "R-102",
        customer,
      }),
      "Ada Lovelace, #R-102",
    );
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: " ",
        number: "R-103",
        customer,
      }),
      "Ada Lovelace, #R-103",
    );
    assert.equal(
      getReservationCalendarTitle({
        internalTitle: null,
        number: "R-104",
        customer: { ...customer, firstName: null, lastName: null },
      }),
      "#R-104",
    );
  });

  test("uses full Polish words for each reservation status", () => {
    assert.deepEqual(
      [
        "pending",
        "confirmed",
        "ongoing",
        "completed",
        "cancelled",
        "rejected",
        "quote",
        "declined",
      ].map(getCalendarReservationStatusLabel),
      [
        "Oczekująca",
        "Potwierdzona",
        "W trakcie",
        "Zakończona",
        "Anulowana",
        "Odrzucona",
        "Wycena",
        "Wycena odrzucona",
      ],
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

  test("builds Polish event details, keeps data values, and uses rooms as location", () => {
    const details = buildReservationCalendarEventDetails({
      reservation: {
        internalTitle: null,
        number: "R-103",
        startDate,
        endDate,
        totalAmount: "125.00",
        customerNotes: "Keep these notes unchanged",
        customer,
      },
      productNames: ["Camera", "Studio (x2)"],
      roomNames: ["Studio (x2)", "Meeting room"],
      statusLabel: "Potwierdzona",
      reservationUrl: "https://example.com/dashboard/reservations/R-103",
    });

    assert.equal(details.summary, "Ada Lovelace, #R-103");
    assert.equal(details.location, "Studio (x2), Meeting room");
    assert.equal(details.startDate, startDate);
    assert.equal(details.endDate, endDate);
    assert.equal(
      details.description,
      [
        "KLIENT",
        "Nazwa: Ada Lovelace",
        "E-mail: ada@example.com",
        "Telefon: +48 123 456 789",
        "",
        "REZERWACJA",
        "Status: Potwierdzona",
        "Numer rezerwacji: #R-103",
        "Produkty:",
        "Camera,",
        "Studio (x2)",
        "Suma: 125.00 PLN",
        "Link: https://example.com/dashboard/reservations/R-103",
        "",
        "UWAGI",
        "Uwagi klienta: Keep these notes unchanged",
      ].join("\n"),
    );
    assert.doesNotMatch(details.description, /Ignored for individual clients/);
    assert.doesNotMatch(details.description, /LOGISTIQUE|LOGISTYKA|ROOMS|EUR/);
  });

  test("omits location when no reserved room products were selected", () => {
    const details = buildReservationCalendarEventDetails({
      reservation: {
        internalTitle: "Event",
        number: "R-105",
        startDate,
        endDate,
        totalAmount: "50.00",
        customerNotes: null,
        customer,
      },
      productNames: ["Camera"],
      roomNames: [],
      statusLabel: "Oczekująca",
      reservationUrl: "https://example.com/dashboard/reservations/R-105",
    });

    assert.equal(details.location, undefined);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import { TimelineReservationDetails } from "./timeline-reservation-details";
import type { TimelineReservation } from "./timeline-utils";

const reservation: TimelineReservation = {
  id: "reservation-1",
  number: "2026-0428",
  status: "confirmed",
  startDate: new Date("2026-08-25T11:30:00.000Z"),
  endDate: new Date("2026-08-27T11:30:00.000Z"),
  customerId: "customer-1",
  customerName: "Test Customer",
  subtotalAmount: "365",
  depositAmount: "0",
  totalAmount: "365",
  quantity: 1,
  assignedUnitIds: [],
};

test("reservation timeline dates follow the active German locale", () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="de"
      timeZone="UTC"
      messages={{
        dashboard: {
          reservations: {
            periodStart: "Beginn",
            periodEnd: "Ende",
            totalAmount: "Gesamt",
          },
        },
      }}
    >
      <TimelineReservationDetails reservation={reservation} currency="EUR" locale="de-DE" />
    </NextIntlClientProvider>,
  );

  assert.match(html, /25\. Aug\./);
  assert.match(html, /27\. Aug\./);
  assert.doesNotMatch(html, /août/);
});

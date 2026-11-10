import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@react-email/render";

import { supportedLocales } from "@louez/types";

import { getEmailTranslations } from "../i18n";
import { ReservationCancelledEmail } from "./reservation-cancelled";

const props = {
  storeName: "Kayaks",
  storeEmail: "store@example.test",
  storePhone: "+33 6 00 00 00 00",
  storeCountry: "FR",
  storeTimezone: "Europe/Paris",
  customerFirstName: "Ada",
  reservationNumber: "2030-0001",
  startDate: new Date("2030-06-01T09:00:00Z"),
  endDate: new Date("2030-06-03T17:00:00Z"),
  items: [
    { name: "Sea kayak", quantity: 2 },
    { name: "Paddle", quantity: 1 },
  ],
  storefrontUrl: "https://kayaks.example.test",
};

test("the store's cancellation renders in every customer language", async () => {
  for (const locale of supportedLocales) {
    const messages = getEmailTranslations(locale).reservationCancelled;
    const html = await render(ReservationCancelledEmail({ ...props, locale }));
    assert.ok(html.includes(messages.title), `${locale}: the title`);
    assert.ok(html.includes(messages.itemsLabel), `${locale}: the items label`);
    assert.match(html, /2030-0001/, `${locale}: the number`);
    assert.match(html, /Sea kayak(<!-- -->)? × 2/, `${locale}: the items`);
    assert.match(html, /Paddle/, `${locale}: every item`);
    assert.match(html, /store@example\.test/, `${locale}: the store's email`);
    assert.match(html, /\+33 6 00 00 00 00/, `${locale}: the store's phone`);
    assert.ok(!/\{(number|name|storeName|timezone)\}/.test(html), `${locale}: no placeholder left`);
  }
});

test("the cancellation says when it was, and nothing of a refund", async () => {
  const html = await render(ReservationCancelledEmail({ ...props, locale: "en" }));
  assert.match(html, /Reservation cancelled/);
  assert.match(html, /Your reservation #2030-0001 has been cancelled/);
  assert.match(html, /Saturday, June 1, 2030/);
  assert.doesNotMatch(html, /refund/i);

  const fr = await render(ReservationCancelledEmail({ ...props, locale: "fr" }));
  assert.match(fr, /Votre réservation #2030-0001 a été annulée/);
  assert.doesNotMatch(fr, /rembours/i);
});

test("the store's own subject, greeting and message replace the defaults", async () => {
  const html = await render(
    ReservationCancelledEmail({
      ...props,
      locale: "en",
      customContent: {
        subject: "Sorry about #{number}",
        greeting: "Dear {name},",
        message: "The river is closed for #{number}.",
      },
    }),
  );
  assert.match(html, /Sorry about #2030-0001/);
  assert.match(html, /Dear Ada,/);
  assert.match(html, /The river is closed for #2030-0001\./);
});

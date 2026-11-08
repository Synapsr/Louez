import assert from "node:assert/strict";
import { test } from "node:test";

import { NOTIFICATION_EVENT_TYPES } from "@louez/types";

import type { EmailLocale } from "@/lib/email/i18n";
import type { NotificationContext } from "@/lib/notifications/dispatcher";

import { buildAdminPushPayload } from "./notifications";

const LOCALES: EmailLocale[] = [
  "fr",
  "en",
  "de",
  "es",
  "it",
  "nl",
  "pl",
  "pt",
  "zh",
  "ja",
  "ru",
  "id",
  "ko",
];

const ctx: NotificationContext = {
  store: { id: "store_push", name: "Vélos du port", settings: { currency: "EUR" } },
  reservation: {
    id: "res_push",
    number: "R-2001",
    startDate: new Date("2027-05-01T08:00:00Z"),
    endDate: new Date("2027-05-03T08:00:00Z"),
    totalAmount: 120,
  },
  customer: { firstName: "Léa", lastName: "Martin", email: "lea@example.test" },
  payment: { amount: 80 },
};

const PUSHED = NOTIFICATION_EVENT_TYPES.filter(
  (event) => event !== "reservation_reminder_pickup" && event !== "reservation_reminder_return",
);

test("every event the dispatcher can push has its own title in every locale", () => {
  for (const locale of LOCALES) {
    const titles = PUSHED.map((event) => buildAdminPushPayload(event, ctx, locale)?.title);
    for (const [index, title] of titles.entries()) {
      assert.ok(title, `${locale} ${PUSHED[index]}`);
      assert.ok(title.startsWith("Vélos du port · "), title);
      assert.doesNotMatch(title, /notifications_|undefined/, title);
    }
    assert.equal(new Set(titles).size, PUSHED.length, `${locale}: titles are distinct`);
  }
});

test("the body names the customer and the reservation, and links to it", () => {
  const payload = buildAdminPushPayload("reservation_cancelled", ctx, "en");
  assert.equal(payload?.title, "Vélos du port · Reservation cancelled");
  assert.match(payload?.body ?? "", /^Léa Martin · #R-2001 · /);
  assert.match(payload?.body ?? "", /120/);
  assert.equal(payload?.url, "/dashboard/reservations/res_push");
});

test("a payment push shows the payment's amount, not the reservation's", () => {
  const payload = buildAdminPushPayload("payment_received", ctx, "fr");
  assert.equal(payload?.title, "Vélos du port · Paiement reçu");
  assert.match(payload?.body ?? "", /80/);
  assert.doesNotMatch(payload?.body ?? "", /120/);
});

test("a payment push uses the payment's currency, a reservation push the reservation's", () => {
  const withCurrencies: NotificationContext = {
    ...ctx,
    reservation: ctx.reservation && { ...ctx.reservation, currency: "GBP" },
    payment: { amount: 80, currency: "USD" },
  };
  assert.match(
    buildAdminPushPayload("payment_failed", withCurrencies, "en")?.body ?? "",
    /dollars/,
  );
  assert.match(
    buildAdminPushPayload("reservation_confirmed", withCurrencies, "en")?.body ?? "",
    /livres/,
  );
});

test("reminders and payloads without a reservation are not pushed", () => {
  assert.equal(buildAdminPushPayload("reservation_reminder_pickup", ctx, "en"), null);
  assert.equal(
    buildAdminPushPayload("reservation_new", { ...ctx, reservation: undefined }, "en"),
    null,
  );
});

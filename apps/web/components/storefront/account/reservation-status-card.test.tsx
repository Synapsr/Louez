import assert from "node:assert/strict";
import { test } from "node:test";
import React, { type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { ReservationStatusCard } from "./reservation-status-card";

const MESSAGES = { en, fr };

const render = (
  props: Partial<ComponentProps<typeof ReservationStatusCard>>,
  locale: keyof typeof MESSAGES = "fr",
) =>
  renderToStaticMarkup(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <NextIntlClientProvider locale={locale} timeZone="Europe/Paris" messages={MESSAGES[locale]}>
        <ReservationStatusCard
          status="confirmed"
          rentalPaid={0}
          rentalDue={30}
          currency="EUR"
          paymentRequired={false}
          customerEmail="guest@example.test"
          {...props}
        />
      </NextIntlClientProvider>
    </PublicEnvProvider>,
  );

test("failed checkout renders the minimum and cancellation, never a pending store decision", () => {
  const html = render({
    status: "cancelled",
    checkoutFailure: {
      source: "checkout_payment_failed",
      reason: "amount_too_small",
      minimumAmount: 0.5,
      currency: "EUR",
    },
  });
  assert.match(html, /Paiement impossible/);
  assert.match(html, /Réservation annulée/);
  assert.match(html, /0,5 EUR/);
  assert.doesNotMatch(html, /En attente de confirmation/);
});

test("a deposit paid: confirmed with the balance due, never all set", () => {
  const html = render({ rentalPaid: 9, rentalDue: 21, paymentRequired: true }, "en");
  assert.match(html, /Confirmed, balance due/);
  assert.match(html, /€21\.00 remains to be paid/);
  assert.doesNotMatch(html, /All set/);
  assert.doesNotMatch(html, /confirmed and paid/);
});

test("the balance is written in the reservation's currency, not the store's", () => {
  const html = render({ rentalPaid: 9, rentalDue: 21, currency: "USD" }, "en");
  assert.match(html, /US\$21\.00 remains to be paid|\$21\.00 remains to be paid/);
  assert.doesNotMatch(html, /€21/);
});

test("a balance due without online payment still states its amount", () => {
  const html = render({ rentalPaid: 9, rentalDue: 21 });
  assert.match(html, /Confirmée, solde à régler/);
  assert.match(html, /Il reste 21,00\s€ à régler/);
});

test("nothing paid yet: payment required", () => {
  const html = render({ paymentRequired: true }, "en");
  assert.match(html, /Payment required/);
  assert.doesNotMatch(html, /balance due/);
});

test("the balance at zero reads all set, confirmed and paid", () => {
  // Paid in full, and paid beyond a total lowered afterwards: nothing is asked.
  for (const rentalPaid of [30, 35]) {
    const html = render({ rentalPaid, rentalDue: 0 }, "en");
    assert.match(html, /All set/);
    assert.match(html, /confirmed and paid/);
  }
});

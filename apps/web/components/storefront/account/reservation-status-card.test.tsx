import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/fr.json";
import { ReservationStatusCard } from "./reservation-status-card";

test("failed checkout renders the minimum and cancellation, never a pending store decision", () => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
      <ReservationStatusCard
        status="cancelled"
        isRentalPaid={false}
        paymentRequired={false}
        customerEmail="guest@example.test"
        checkoutFailure={{
          source: "checkout_payment_failed",
          reason: "amount_too_small",
          minimumAmount: 0.5,
          currency: "EUR",
        }}
      />
    </NextIntlClientProvider>,
  );
  assert.match(html, /Paiement impossible/);
  assert.match(html, /Réservation annulée/);
  assert.match(html, /0,5 EUR/);
  assert.doesNotMatch(html, /En attente de confirmation/);
});

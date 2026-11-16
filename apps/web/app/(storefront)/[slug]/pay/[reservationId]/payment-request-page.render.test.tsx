import assert from "node:assert/strict";
import { mock, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The server action is not under test: the page only renders here.
mock.module("./actions", {
  namedExports: { initiatePayment: async () => ({ ok: false, error: "invalid_token" }) },
});

// The customer's payment page names what is asked for in their language: a
// French page says "Location", never the English word stored on the request.

const render = async (locale: "en" | "fr", type: "rental" | "custom") => {
  const { PaymentRequestPage } = await import("./payment-request-page");
  return renderToStaticMarkup(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider
          locale={locale}
          timeZone="Europe/Paris"
          messages={locale === "fr" ? fr : en}
        >
          <PaymentRequestPage
            slug="atelier"
            storeName="Atelier"
            reservation={{ id: "res_1", number: "R-1042" }}
            paymentRequest={{ id: "req_1", amount: 46, currency: "EUR", type }}
            customerFirstName="Camille"
            requiresContractAcceptance={false}
            token="token"
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </PublicEnvProvider>,
  );
};

test("the payment page names the request in the customer's language", async () => {
  const rental = await render("fr", "rental");
  assert.match(rental, />Location</);
  assert.doesNotMatch(rental, /Rental/);
  const custom = await render("fr", "custom");
  assert.match(custom, />Paiement</);
  assert.doesNotMatch(custom, />Payment</);
  assert.match(await render("en", "rental"), />Rental</);
});

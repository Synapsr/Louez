import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";

import { NextIntlClientProvider } from "next-intl";

import { ReservationGateDialog } from "@/components/dashboard/reservation-gate-dialog";
import { StoreProvider } from "@/contexts/store-context";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { DEMO_RULES } from "./fixtures";
import { getDemoMessages } from "./messages";
import type { DemoScene } from "./policy";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The scenes that show the reservation file, first or after a bar or row opens it.
const RESERVATION_FILE_SCENES: DemoScene[] = [
  "rental",
  "planning",
  "reservation",
  "planning-timeline",
  "reservations-paid",
  "reservation-deposit",
  "customer-reminders",
  "customer-detail",
  "customers-search",
  "delivery-calendar",
  "products-list",
  "product-availability",
  "contract-document",
  "contract-content",
  "contract-trace",
];

// The file's actions hold the card gate's dialog, closed in a demo; it still reads its
// text, and a missing namespace is logged as MISSING_MESSAGE on every server render.
test("the reservation file's gate dialog finds its text in every scene that shows it", () => {
  for (const [locale, messages] of [
    ["fr", fr],
    ["en", en],
  ] as const) {
    for (const scene of RESERVATION_FILE_SCENES) {
      const errors: string[] = [];
      renderToString(
        <NextIntlClientProvider
          locale={locale}
          timeZone="Europe/Paris"
          messages={getDemoMessages(scene, messages)}
          onError={(error) => errors.push(error.message)}
        >
          <StoreProvider
            storeId="demo-store"
            storeSlug="demo"
            storeName="Maison du Vélo"
            currency="EUR"
            timezone="Europe/Paris"
            basePath=""
            periodRules={DEMO_RULES}
            role="owner"
          >
            <ReservationGateDialog open={false} onOpenChange={() => undefined} />
          </StoreProvider>
        </NextIntlClientProvider>,
      );
      assert.deepEqual(errors, [], `${scene} (${locale})`);
    }
  }
});

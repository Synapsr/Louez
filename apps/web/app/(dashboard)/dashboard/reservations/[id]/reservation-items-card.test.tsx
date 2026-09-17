import assert from "node:assert/strict";
import test from "node:test";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/fr.json";
import { ReservationItemsCard, type ReservationItemsDisplay } from "./reservation-items-card";

const render = (reservation: ReservationItemsDisplay) =>
  renderToStaticMarkup(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.io",
        NEXT_PUBLIC_APP_DOMAIN: "louez.io",
      })}
    >
      <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
        <ReservationItemsCard
          reservation={reservation}
          startDate={new Date("2026-09-22T07:00:00Z")}
          endDate={new Date("2026-09-22T16:00:00Z")}
          storeTimezone="Europe/Paris"
          durationDays={0}
          durationHours={9}
          currency="EUR"
          rental={115}
          insuredProductIds={new Set(["bike"])}
          renderUnitAssignment={(item) => <button>Affecter {item.id}</button>}
        />
      </NextIntlClientProvider>
    </PublicEnvProvider>,
  ).replace(/\s|&nbsp;/g, " ");

const reservation: ReservationItemsDisplay = {
  items: [
    {
      id: "line-1",
      productId: "bike",
      quantity: 2,
      unitPrice: "60",
      totalPrice: "120",
      product: {
        name: "Nom actuel",
        bookingAttributeAxes: [{ key: "size", label: "Taille", position: 0 }],
      },
      productSnapshot: { name: "Vélo réservé", selectedAttributes: { size: "M" } },
    },
  ],
  subtotalAmount: "120",
  subtotalExclTax: "100",
  taxAmount: "20",
  taxRate: "20",
  discountAmount: "10",
  promoCodeSnapshot: { code: "VELO10" },
  deliveryFee: "5",
  depositAmount: "300",
};

test("shared reservation card preserves taxes, promotion, delivery, deposit and unit controls", () => {
  const html = render(reservation);
  for (const text of [
    "Vélo réservé",
    "Taille: M",
    "VELO10",
    "100,00",
    "120,00",
    "115,00",
    "300,00",
    "09:00",
    "18:00",
    "Affecter line-1",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /href="\/dashboard\/products\/bike"/);
  assert.doesNotMatch(html, /Nom actuel/);
});

test("fixture rows remain unlinked and hide absent billing lines", () => {
  const html = render({
    items: [
      {
        id: "demo",
        productId: null,
        quantity: 1,
        unitPrice: "20",
        totalPrice: "20",
        product: { name: "Vélo" },
      },
    ],
    subtotalAmount: "20",
    depositAmount: "0",
  });
  assert.doesNotMatch(html, /href=|VELO10|Caution totale|TVA/);
  assert.match(html, /Sous-total location/);
});

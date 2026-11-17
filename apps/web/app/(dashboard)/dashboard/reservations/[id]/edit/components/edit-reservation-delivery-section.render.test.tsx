import "@/lib/testing/install-dom";
// Before the field, which builds the oRPC client with the `fetch` it finds.
import { controlledRpc } from "@/lib/testing/fake-fetch";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { NextIntlClientProvider } from "next-intl";

import type { AddressDetails, AddressSuggestion, DeliverySettings } from "@louez/types";

import {
  blur,
  enableMockTimers,
  mount,
  pointerClick,
  settle,
  tick,
  typeInto,
} from "@/lib/testing/dom";
import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/en.json";

import { useEditReservationDelivery } from "../hooks/use-edit-reservation-delivery";
import type { ReservationDelivery, StoreDeliveryInfo } from "../types";
import { EditReservationDeliverySection } from "./edit-reservation-delivery-section";

// The delivery of a reservation the store edits: every address leg without
// its place is an error of the form, which refuses to save
// (`delivery.hasErrors`), whether the edit changed it or not. Picking a
// suggestion, or sending the leg back to the store, clears it. A located leg
// stored without its country, city or postal code is no error.

const SEARCH_DELAY = 300;
const BLUR_DELAY = 120;
const LEG_ERROR = messages.dashboard.reservations.edit.delivery.outboundAddressNotChosen;

const DELIVERY: DeliverySettings = {
  enabled: true,
  mode: "optional",
  pricePerKm: 1.5,
  minimumFee: 0,
  maximumDistance: 100,
  freeDeliveryThreshold: null,
};
const STORE_DELIVERY: StoreDeliveryInfo = {
  settings: DELIVERY,
  latitude: 47.2125,
  longitude: -1.5592,
  address: "12 rue des Cyclistes, 44000 Nantes",
  locations: [],
};

const carquefou: AddressDetails = {
  placeId: "carquefou",
  formattedAddress: "24 Rue du Moulin, 44470 Carquefou",
  latitude: 47.2969,
  longitude: -1.4901,
};
const carquefouSuggestion: AddressSuggestion = {
  placeId: "carquefou",
  description: "24 Rue du Moulin, Carquefou",
  mainText: "24 Rue du Moulin",
  secondaryText: "Carquefou",
};

/** A reservation delivered for 18.00 to this address, brought back to the store. */
const deliveredTo = (outbound: {
  address: string;
  latitude: string | null;
  longitude: string | null;
}): ReservationDelivery => ({
  outboundMethod: "address",
  returnMethod: "store",
  pickupLocationId: null,
  returnLocationId: null,
  pickupLocationSnapshot: null,
  returnLocationSnapshot: null,
  deliveryAddress: outbound.address,
  deliveryCity: null,
  deliveryPostalCode: null,
  deliveryCountry: null,
  deliveryLatitude: outbound.latitude,
  deliveryLongitude: outbound.longitude,
  deliveryDistanceKm: outbound.latitude ? "12.00" : null,
  deliveryFee: "18.00",
  returnAddress: null,
  returnCity: null,
  returnPostalCode: null,
  returnCountry: null,
  returnLatitude: null,
  returnLongitude: null,
  returnDistanceKm: null,
});

/** The address and distance calls, at the network, answered by the test; a distance answers 12 km at once. */
const controlledNetwork = () => ({
  queryClient: new QueryClient(),
  requests: controlledRpc({ distance: { distanceKm: 12 } }),
});

const renderSection = (
  initialDelivery: ReservationDelivery,
  storeDelivery: StoreDeliveryInfo | null = STORE_DELIVERY,
) => {
  const { queryClient, requests } = controlledNetwork();
  const delivery = { current: null as ReturnType<typeof useEditReservationDelivery> | null };

  const Section = () => {
    const state = useEditReservationDelivery({
      storeDelivery,
      initialDelivery,
      subtotal: 100,
    });
    delivery.current = state;
    // The form shows the section only for a store with delivery or several locations.
    if (!storeDelivery) return null;
    return (
      <EditReservationDeliverySection
        outbound={state.outbound}
        inbound={state.inbound}
        totalFee={state.totalFee}
        isDeliveryIncluded={state.isDeliveryIncluded}
        deliveryMinimumWarning={null}
        storeAddress={STORE_DELIVERY.address}
        locations={[]}
        currency="EUR"
        onOutboundMethodChange={state.setOutboundMethod}
        onInboundMethodChange={state.setInboundMethod}
        onOutboundLocationChange={state.setOutboundLocationId}
        onInboundLocationChange={state.setInboundLocationId}
        onOutboundAddressChange={state.setOutboundAddress}
        onInboundAddressChange={state.setInboundAddress}
      />
    );
  };

  const view = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
          <Section />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </PublicEnvProvider>,
  );
  return {
    ...view,
    requests,
    delivery,
    get input() {
      return view.container.querySelector("input") as unknown as HTMLInputElement;
    },
    legError: () => view.container.querySelector('[role="alert"]')?.textContent ?? null,
    fieldHint: () => view.container.querySelector("[data-address-choice-hint]"),
  };
};

let unmount: (() => void) | null = null;
beforeEach(() => enableMockTimers());
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  mock.timers.reset();
});

test("a delivery address typed over a priced one is an error until a suggestion is picked", async () => {
  const section = renderSection(
    deliveredTo({ address: "8 Quai de la Douane, Nantes", latitude: "47.21", longitude: "-1.55" }),
  );
  unmount = section.unmount;
  assert.equal(section.delivery.current?.hasErrors, false);

  typeInto(section.input, "24 rue du moulin");
  blur(section.input);
  await tick(BLUR_DELAY);

  assert.equal(section.legError(), LEG_ERROR);
  assert.equal(section.delivery.current?.hasErrors, true, "the save is refused");
  assert.equal(section.fieldHint(), null, "the form says it once, as its error");

  typeInto(section.input, "24 rue du moulin");
  await tick(SEARCH_DELAY);
  section.requests
    .findLast((request) => request.endpoint === "autocomplete")
    ?.answer.resolve({
      suggestions: [carquefouSuggestion],
    });
  await settle();
  pointerClick(
    document.querySelector('[data-address-suggestion="carquefou"]') as unknown as HTMLElement,
  );
  // The pick is sent through the client once its steps have run.
  await settle();
  section.requests
    .findLast((request) => request.endpoint === "details")
    ?.answer.resolve({
      details: carquefou,
    });
  await settle();
  await tick(BLUR_DELAY);

  assert.equal(section.legError(), null);
  assert.equal(section.delivery.current?.hasErrors, false);
  assert.equal(section.delivery.current?.outbound.address.latitude, carquefou.latitude);
});

test("a delivery address stored without its place is an error until the leg goes back to the store", async () => {
  const section = renderSection(
    deliveredTo({ address: "Le Moulin, route de Nantes", latitude: null, longitude: null }),
  );
  unmount = section.unmount;
  await settle();

  assert.equal(section.legError(), LEG_ERROR);
  assert.equal(section.delivery.current?.hasErrors, true, "the save is refused");

  const storePickup = [...section.container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(messages.dashboard.reservations.edit.delivery.storePickup),
  ) as unknown as HTMLButtonElement;
  act(() => storePickup.click());
  await settle();

  assert.equal(section.legError(), null);
  assert.equal(section.delivery.current?.hasErrors, false);
});

test("without a delivery section, a stored address without its place blocks no save", async () => {
  // A store with neither delivery nor several locations: the form shows no
  // delivery section and sends none, so there is nothing to choose and nothing to refuse.
  const section = renderSection(
    deliveredTo({ address: "Le Moulin, route de Nantes", latitude: null, longitude: null }),
    null,
  );
  unmount = section.unmount;
  await settle();

  assert.equal(section.delivery.current?.hasErrors, false);
  assert.equal(section.delivery.current?.outbound.error, null);
  assert.equal(section.legError(), null);
});

test("a located delivery address stored without its country, city or postal code is no error", async () => {
  const section = renderSection(
    deliveredTo({ address: "24 Rue du Moulin", latitude: "47.2969000", longitude: "-1.4901000" }),
  );
  unmount = section.unmount;
  await settle();

  assert.equal(section.legError(), null);
  assert.equal(section.delivery.current?.hasErrors, false);
});

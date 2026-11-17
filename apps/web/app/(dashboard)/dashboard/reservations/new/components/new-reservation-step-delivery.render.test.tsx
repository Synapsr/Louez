import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import type { AddressDetails, AddressSuggestion, DeliverySettings } from "@louez/types";

import {
  blur,
  deferred,
  enableMockTimers,
  focus,
  mount,
  pointerClick,
  settle,
  tick,
  typeInto,
} from "@/lib/testing/dom";
import messages from "@/messages/en.json";

import { useNewReservationDelivery } from "../hooks/use-new-reservation-delivery";
import { NewReservationStepDelivery } from "./new-reservation-step-delivery";

// The delivery step of a reservation created from the dashboard, for a store
// that delivers every order: the fee comes only from an address the team
// member chose, from the list or the map.

const SEARCH_DELAY = 300;
const BLUR_DELAY = 120;
const CHOOSE_HINT = messages.common.addressInput.chooseFromListOrMap;

const STORE = { latitude: 47.2125, longitude: -1.5592 };
const DELIVERY: DeliverySettings = {
  enabled: true,
  mode: "required",
  pricePerKm: 1.5,
  minimumFee: 10,
  maximumDistance: 30,
  freeDeliveryThreshold: null,
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

type Endpoint = "autocomplete" | "details" | "resolve" | "distance";

/** The address endpoints answered by the test; a distance answers 12 km at once. */
const controlledQueryClient = () => {
  const requests: Array<{
    endpoint: Endpoint;
    key: string;
    answer: ReturnType<typeof deferred<unknown>>;
  }> = [];
  const queryClient = new QueryClient();
  queryClient.fetchQuery = ((options: { queryKey: unknown }) => {
    const key = JSON.stringify(options.queryKey);
    const endpoint = (["autocomplete", "details", "resolve", "distance"] as const).find((name) =>
      key.includes(`"${name}"`),
    );
    assert.ok(endpoint, `unexpected query ${key}`);
    const answer = deferred<unknown>();
    requests.push({ endpoint, key, answer });
    if (endpoint === "distance") answer.resolve({ distanceKm: 12 });
    return answer.promise;
  }) as unknown as typeof queryClient.fetchQuery;
  return { queryClient, requests };
};

const renderStep = () => {
  const { queryClient, requests } = controlledQueryClient();
  const delivery = { current: null as ReturnType<typeof useNewReservationDelivery> | null };

  const Step = () => {
    const state = useNewReservationDelivery({
      deliverySettings: DELIVERY,
      storeLatitude: STORE.latitude,
      storeLongitude: STORE.longitude,
      subtotal: 100,
    });
    delivery.current = state;
    return (
      <NewReservationStepDelivery
        deliverySettings={DELIVERY}
        subtotal={100}
        currency="EUR"
        locations={[]}
        isDeliveryForced={state.isDeliveryForced}
        isDeliveryIncluded={state.isDeliveryIncluded}
        outboundMethod={state.outboundMethod}
        pickupLocationId={state.pickupLocationId}
        outboundAddress={state.outboundAddress}
        outboundDistance={state.outboundDistance}
        outboundFee={state.outboundFee}
        outboundError={state.outboundError}
        onOutboundMethodChange={state.handleOutboundMethodChange}
        onPickupLocationChange={state.handlePickupLocationChange}
        onOutboundAddressChange={state.handleOutboundAddressChange}
        returnMethod={state.returnMethod}
        returnLocationId={state.returnLocationId}
        returnAddress={state.returnAddress}
        returnDistance={state.returnDistance}
        returnFee={state.returnFee}
        returnError={state.returnError}
        onReturnMethodChange={state.handleReturnMethodChange}
        onReturnLocationChange={state.handleReturnLocationChange}
        onReturnAddressChange={state.handleReturnAddressChange}
        totalFee={state.totalFee}
      />
    );
  };

  const view = mount(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
        <Step />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const lookups = () =>
    requests.filter((request) => request.endpoint === "details" || request.endpoint === "resolve");
  return {
    ...view,
    requests,
    lookups,
    distances: () => requests.filter((request) => request.endpoint === "distance"),
    delivery,
    get input() {
      return view.container.querySelector("input") as unknown as HTMLInputElement;
    },
    hint: () => view.container.querySelector("[data-address-choice-hint]")?.textContent ?? null,
    showsFee: () =>
      view.container.textContent?.includes(
        messages.dashboard.reservations.manualForm.deliveryFee,
      ) ?? false,
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

test("a delivery address typed and left without a pick prices nothing and asks for a choice", async () => {
  const step = renderStep();
  unmount = step.unmount;

  typeInto(step.input, "24 rue du moulin carquefou");
  blur(step.input);
  await tick(BLUR_DELAY);

  assert.deepEqual(step.lookups(), []);
  assert.deepEqual(step.distances(), []);
  assert.equal(step.input.value, "24 rue du moulin carquefou");
  assert.equal(step.delivery.current?.outboundAddress.latitude, null);
  assert.equal(step.delivery.current?.canContinue, false);
  assert.equal(step.showsFee(), false);
  assert.equal(step.hint(), CHOOSE_HINT);
});

test("a picked delivery address is priced from the pick and stays when the field is left again", async () => {
  const step = renderStep();
  unmount = step.unmount;

  typeInto(step.input, "24 rue du moulin");
  await tick(SEARCH_DELAY);
  step.requests
    .findLast((request) => request.endpoint === "autocomplete")
    ?.answer.resolve({
      suggestions: [carquefouSuggestion],
    });
  await settle();
  pointerClick(
    document.querySelector('[data-address-suggestion="carquefou"]') as unknown as HTMLElement,
  );
  step.lookups()[0].answer.resolve({ details: carquefou });
  await settle();
  await tick(BLUR_DELAY);
  focus(step.input);
  blur(step.input);
  await tick(BLUR_DELAY);

  assert.equal(step.lookups().length, 1);
  assert.equal(step.distances().length, 1);
  assert.ok(step.distances()[0].key.includes(String(carquefou.latitude)));
  assert.equal(step.input.value, carquefou.formattedAddress);
  assert.equal(step.delivery.current?.outboundAddress.latitude, carquefou.latitude);
  assert.equal(step.delivery.current?.canContinue, true);
  assert.equal(step.showsFee(), true);
  assert.equal(step.hint(), null);
});

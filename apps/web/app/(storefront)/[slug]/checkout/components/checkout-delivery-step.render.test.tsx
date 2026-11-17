import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import type { AddressDetails, AddressSuggestion, DeliverySettings } from "@louez/types";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { useAppForm } from "@/hooks/form/form";
import {
  blur,
  deferred,
  enableMockTimers,
  mount,
  pressKey,
  settle,
  tick,
  typeInto,
} from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/en.json";

import { useCheckoutDelivery } from "../hooks/use-checkout-delivery";
import { checkoutFormOptions } from "../validator.checkout";
import { CheckoutDeliveryStep } from "./checkout-delivery-step";

// The delivery step of the checkout, mounted as the checkout mounts it, for a
// store that delivers every order: the fee is computed only from an address
// the customer chose.

const SEARCH_DELAY = 300;
const BLUR_DELAY = 120;
const CHOOSE_HINT = messages.common.addressInput.chooseFromList;

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

interface Destination {
  latitude: number;
  longitude: number;
}

const renderStep = () => {
  const searches: Array<{
    query: string;
    answer: ReturnType<typeof deferred<AddressSuggestion[]>>;
  }> = [];
  const details: Array<{ placeId: string; answer: ReturnType<typeof deferred<AddressDetails>> }> =
    [];
  const distances: Destination[] = [];
  const delivery = { current: null as ReturnType<typeof useCheckoutDelivery> | null };

  const source = {
    search: (query: string) => {
      const answer = deferred<AddressSuggestion[]>();
      searches.push({ query, answer });
      return answer.promise;
    },
    details: (placeId: string) => {
      const answer = deferred<AddressDetails>();
      details.push({ placeId, answer });
      return answer.promise;
    },
  };

  const Step = () => {
    const form = useAppForm(checkoutFormOptions);
    const state = useCheckoutDelivery({
      deliverySettings: DELIVERY,
      storeLatitude: STORE.latitude,
      storeLongitude: STORE.longitude,
      subtotal: 100,
      resolveDistance: ({ destinationLatitude, destinationLongitude }) => {
        distances.push({ latitude: destinationLatitude, longitude: destinationLongitude });
        return 12;
      },
    });
    delivery.current = state;
    return (
      <form.AppForm>
        <CheckoutDeliveryStep
          form={form}
          deliverySettings={DELIVERY}
          delivery={state}
          subtotal={100}
          storeName="Atelier"
          storeLatitude={STORE.latitude}
          storeLongitude={STORE.longitude}
          onUseCustomerAddress={() => {}}
          onBack={() => {}}
          onContinue={() => {}}
          stepDirection="forward"
          showMap={false}
          geolocationEnabled={false}
          addressSource={source}
          autoFocus={false}
        />
      </form.AppForm>
    );
  };

  const view = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
          <Step />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </PublicEnvProvider>,
  );

  const continueButton = () =>
    [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === messages.storefront.checkout.continue,
    ) as unknown as HTMLButtonElement;

  return {
    ...view,
    searches,
    details,
    distances,
    delivery,
    get input() {
      return view.container.querySelector(
        "#fulfillment-outbound-address",
      ) as unknown as HTMLInputElement;
    },
    hint: () => view.container.querySelector("[data-address-choice-hint]")?.textContent ?? null,
    canContinue: () => !continueButton().disabled,
    option: (placeId: string) =>
      document.querySelector(`[data-address-suggestion="${placeId}"]`) as unknown as HTMLElement,
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
  // Enter shows what can be chosen; it neither sends the step nor resolves the text.
  pressKey(step.input, "Enter");
  step.searches.at(-1)?.answer.resolve([]);
  await settle();
  blur(step.input);
  await tick(BLUR_DELAY);

  assert.deepEqual(step.details, []);
  assert.deepEqual(step.distances, []);
  assert.equal(step.input.value, "24 rue du moulin carquefou");
  assert.equal(step.delivery.current?.outboundAddress.latitude, null);
  assert.equal(step.hint(), CHOOSE_HINT);
  assert.equal(step.canContinue(), false);
});

test("a delivery address picked with the keyboard is priced from the pick, and no lookup follows", async () => {
  const step = renderStep();
  unmount = step.unmount;

  typeInto(step.input, "24 rue du moulin");
  await tick(SEARCH_DELAY);
  step.searches.at(-1)?.answer.resolve([carquefouSuggestion]);
  await settle();
  pressKey(step.input, "ArrowDown");
  pressKey(step.input, "Enter");
  step.details[0].answer.resolve(carquefou);
  await settle();
  await tick(BLUR_DELAY * 2);

  assert.deepEqual(
    step.details.map((request) => request.placeId),
    ["carquefou"],
  );
  assert.deepEqual(step.distances.at(-1), {
    latitude: carquefou.latitude,
    longitude: carquefou.longitude,
  });
  assert.equal(step.input.value, carquefou.formattedAddress);
  assert.equal(step.hint(), null);
  assert.equal(step.canContinue(), true);
});

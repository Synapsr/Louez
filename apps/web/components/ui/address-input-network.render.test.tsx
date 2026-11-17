import "@/lib/testing/install-dom";
// Before the field, which builds the oRPC client with the `fetch` it finds.
import { rpcAnswer, setFetchHandler } from "@/lib/testing/fake-fetch";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import type { AddressSuggestion } from "@louez/types";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { enableMockTimers, mount, pressKey, settle, tick, typeInto } from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/en.json";

import { AddressInput } from "./address-input";
import { ADDRESS_REQUEST_BOUND_MS } from "./util.address-input";

// The address field through the app's own client and a real query client: a
// request given up at the bound is cancelled, so asking the same text again
// reaches the network again. A request another field still waits for is not.

const SEARCH_DELAY = 300;

const brest: AddressSuggestion = {
  placeId: "brest",
  description: "8 Quai de la Douane, Brest",
  mainText: "8 Quai de la Douane",
  secondaryText: "Brest",
};

interface Call {
  url: string;
  signal: AbortSignal;
  answer: (response: Response) => void;
}

/** Every call reaches the network and waits for the test, or for its cancellation. */
const network = () => {
  const calls: Call[] = [];
  setFetchHandler(
    (request) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ url: request.url, signal: request.signal, answer: resolve });
        request.signal.addEventListener("abort", () => reject(request.signal.reason));
      }),
  );
  return calls;
};

const Field = ({ name }: { name: string }) => {
  const [address, setAddress] = useState("");
  return (
    <AddressInput
      name={name}
      showMapPicker={false}
      value={address}
      latitude={null}
      longitude={null}
      onChange={(next) => setAddress(next)}
    />
  );
};

const renderFields = (names: string[]) => {
  const view = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
          {names.map((name) => (
            <Field key={name} name={name} />
          ))}
        </NextIntlClientProvider>
      </QueryClientProvider>
    </PublicEnvProvider>,
  );
  return {
    ...view,
    input: (name: string) =>
      view.container.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement,
    isSpinning: () => view.container.querySelector(".animate-spin") !== null,
    shownSuggestions: () =>
      [...document.querySelectorAll("[data-address-suggestion]")].map((element) =>
        element.getAttribute("data-address-suggestion"),
      ),
  };
};

/** Lets the client's own steps (serializing, sending) run. */
const flush = async () => {
  for (let round = 0; round < 4; round += 1) await act(() => Promise.resolve());
  await settle();
};

let unmount: (() => void) | null = null;
beforeEach(() => enableMockTimers());
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  mock.timers.reset();
});

test("a search given up at the bound is cancelled, and asking the same text again reaches the network", async () => {
  const calls = network();
  const view = renderFields(["delivery"]);
  unmount = view.unmount;

  typeInto(view.input("delivery"), "8 quai");
  await tick(SEARCH_DELAY);
  await flush();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("autocomplete"));

  await tick(ADDRESS_REQUEST_BOUND_MS);
  await flush();
  assert.equal(view.isSpinning(), false);
  assert.equal(calls[0].signal.aborted, true, "the request given up is cancelled");

  pressKey(view.input("delivery"), "Enter");
  await flush();
  assert.equal(calls.length, 2, "the same text is asked again");
  calls[1].answer(rpcAnswer({ suggestions: [brest] }));
  await flush();

  assert.deepEqual(view.shownSuggestions(), ["brest"]);
});

test("a search another field still waits for is not cancelled when the first gives up", async () => {
  const calls = network();
  const view = renderFields(["delivery", "collection"]);
  unmount = view.unmount;

  typeInto(view.input("delivery"), "8 quai");
  await tick(SEARCH_DELAY);
  await flush();
  await tick(ADDRESS_REQUEST_BOUND_MS / 2);
  typeInto(view.input("collection"), "8 quai");
  await tick(SEARCH_DELAY);
  await flush();
  assert.equal(calls.length, 1, "the second field waits for the same request");

  await tick(ADDRESS_REQUEST_BOUND_MS / 2);
  await flush();
  assert.equal(calls[0].signal.aborted, false, "the other field still waits for it");

  calls[0].answer(rpcAnswer({ suggestions: [brest] }));
  await flush();
  assert.deepEqual(view.shownSuggestions(), ["brest"]);
});

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
import { orpc } from "@/lib/orpc/react";
import { enableMockTimers, mount, pressKey, settle, tick, typeInto } from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/en.json";

import { AddressInput } from "./address-input";
import { ADDRESS_REQUEST_BOUND_MS } from "./util.address-input";

// The address field through the app's own client, next to a real query
// client: each search and pick of the field is its own request, aborted when
// the field gives it up (at the bound, or when it goes), so asking the same
// text again reaches the network again. A query of the same text that another
// consumer runs through the query client is never cancelled by the field.

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

/** The query clients of the suite, emptied after each test so no query outlives it. */
const queryClients: QueryClient[] = [];
const newQueryClient = () => {
  const queryClient = new QueryClient();
  queryClients.push(queryClient);
  return queryClient;
};

const renderFields = (names: string[], queryClient = newQueryClient()) => {
  const view = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={queryClient}>
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
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
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

test("each field asks on its own: one giving up aborts only its own request", async () => {
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
  assert.equal(calls.length, 2, "each field sends its own request");

  await tick(ADDRESS_REQUEST_BOUND_MS / 2);
  await flush();
  assert.equal(calls[0].signal.aborted, true, "the first field gave its request up");
  assert.equal(calls[1].signal.aborted, false, "the second field still waits for its own");

  calls[1].answer(rpcAnswer({ suggestions: [brest] }));
  await flush();
  assert.deepEqual(view.shownSuggestions(), ["brest"]);
});

for (const [ending, end] of [
  [
    "gives its search up",
    (_view: ReturnType<typeof renderFields>) => tick(ADDRESS_REQUEST_BOUND_MS),
  ],
  [
    "goes",
    async (view: ReturnType<typeof renderFields>) => {
      view.unmount();
      unmount = null;
    },
  ],
] as const) {
  test(`a query of the same text another consumer runs is not cancelled when the field ${ending}`, async () => {
    const calls = network();
    const queryClient = newQueryClient();
    const view = renderFields(["delivery"], queryClient);
    unmount = view.unmount;

    const consumer = queryClient.fetchQuery(
      orpc.public.address.autocomplete.queryOptions({ input: { query: "8 quai" } }),
    );
    // What the other consumer got: its answer, or the error it was cancelled with.
    let outcome: unknown = "pending";
    consumer.then(
      (answer) => (outcome = answer),
      (error: unknown) => (outcome = error),
    );
    await flush();
    assert.equal(calls.length, 1);
    typeInto(view.input("delivery"), "8 quai");
    await tick(SEARCH_DELAY);
    await flush();

    await end(view);
    await flush();
    assert.equal(calls[0].signal.aborted, false, "the other consumer's request goes on");

    calls[0].answer(rpcAnswer({ suggestions: [brest] }));
    await flush();
    assert.deepEqual(outcome, { suggestions: [brest] });
  });
}

import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import type { AddressDetails, AddressSuggestion } from "@louez/types";

import {
  blur,
  deferred,
  enableMockTimers,
  focus,
  mount,
  pointerClick,
  pressKey,
  settle,
  tick,
  typeInto,
} from "@/lib/testing/dom";
import messages from "@/messages/en.json";

import { AddressInput } from "./address-input";

// The address field as the fields that need coordinates use it (delivery at
// checkout and in the dashboard, the store's addresses): leaving it resolves
// the typed text. An answer only lands if nothing happened to the field since
// it was asked, and the spinner belongs to the request that started it.

const SEARCH_DELAY = 300;
const BLUR_DELAY = 120;

const details = (placeId: string, formattedAddress: string): AddressDetails => ({
  placeId,
  formattedAddress,
  latitude: placeId.length,
  longitude: 2,
});
const suggestion = (placeId: string, description: string): AddressSuggestion => ({
  placeId,
  description,
  mainText: description,
  secondaryText: "",
});

/** An address service whose every answer the test gives, when it chooses. */
const controlledSource = () => {
  const searches: Array<{
    query: string;
    answer: ReturnType<typeof deferred<AddressSuggestion[]>>;
  }> = [];
  const resolves: Array<{
    query: string;
    answer: ReturnType<typeof deferred<AddressDetails | null>>;
  }> = [];
  return {
    searches,
    resolves,
    source: {
      search: (query: string) => {
        const answer = deferred<AddressSuggestion[]>();
        searches.push({ query, answer });
        return answer.promise;
      },
      resolve: (query: string) => {
        const answer = deferred<AddressDetails | null>();
        resolves.push({ query, answer });
        return answer.promise;
      },
    },
  };
};

interface FieldState {
  address: string;
  latitude: number | null;
  longitude: number | null;
}

/** The field's value lives in its parent, which can unmount it and mount it again. */
const DeliveryField = ({
  source,
  state,
  controls,
}: {
  source: ReturnType<typeof controlledSource>["source"];
  state: { current: FieldState };
  controls: { setShown: (shown: boolean) => void };
}) => {
  const [field, setField] = useState<FieldState>({ address: "", latitude: null, longitude: null });
  const [shown, setShown] = useState(true);
  state.current = field;
  controls.setShown = setShown;
  if (!shown) return null;
  return (
    <AddressInput
      source={source}
      showMapPicker={false}
      value={field.address}
      latitude={field.latitude}
      longitude={field.longitude}
      onChange={(address, latitude, longitude) => setField({ address, latitude, longitude })}
    />
  );
};

const renderField = () => {
  const control = controlledSource();
  const state = { current: { address: "", latitude: null, longitude: null } as FieldState };
  const controls = { setShown: (_shown: boolean) => {} };
  const view = mount(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <DeliveryField source={control.source} state={state} controls={controls} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const isSpinning = () => view.container.querySelector(".animate-spin") !== null;
  const option = (placeId: string) =>
    document.querySelector(`[data-address-suggestion="${placeId}"]`) as unknown as HTMLElement;
  const shownSuggestions = () =>
    [...document.querySelectorAll("[data-address-suggestion]")].map((element) =>
      element.getAttribute("data-address-suggestion"),
    );
  /** Leaves the field, as a step change does, and comes back to a new one. */
  const remount = () => {
    act(() => controls.setShown(false));
    act(() => controls.setShown(true));
  };
  return {
    ...control,
    ...view,
    get input() {
      return view.container.querySelector("input") as unknown as HTMLInputElement;
    },
    state,
    isSpinning,
    option,
    shownSuggestions,
    remount,
    hide: () => act(() => controls.setShown(false)),
  };
};

/** Types, lets the search start and answers it with these suggestions. */
const showSuggestions = async (
  field: ReturnType<typeof renderField>,
  text: string,
  found: AddressSuggestion[],
) => {
  typeInto(field.input, text);
  await tick(SEARCH_DELAY);
  field.searches.at(-1)?.answer.resolve(found);
  await settle();
};

let unmount: (() => void) | null = null;
beforeEach(() => enableMockTimers());
afterEach(() => {
  unmount?.();
  unmount = null;
  mock.timers.reset();
});

test("leaving the delivery field still replaces the typed text by the lookup's best match", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai de la douane");
  blur(field.input);
  await tick(BLUR_DELAY);
  assert.deepEqual(
    field.resolves.map((resolve) => resolve.query),
    ["8 quai de la douane"],
  );
  field.resolves[0].answer.resolve(details("brest", "8 Quai de la Douane, 29200 Brest"));
  await settle();

  assert.equal(field.input.value, "8 Quai de la Douane, 29200 Brest");
  assert.deepEqual(field.state.current, {
    address: "8 Quai de la Douane, 29200 Brest",
    latitude: 5,
    longitude: 2,
  });
});

for (const outcome of ["answers", "fails"] as const) {
  test(`a picked suggestion that ${outcome} after the text was edited writes nothing`, async () => {
    const field = renderField();
    unmount = field.unmount;

    await showSuggestions(field, "8 quai", [suggestion("brest", "8 Quai de la Douane, Brest")]);
    pointerClick(field.option("brest"));
    await tick(BLUR_DELAY);
    focus(field.input);
    typeInto(field.input, "12 rue de Siam");

    const pick = field.resolves[0];
    assert.equal(pick.query, "brest");
    if (outcome === "answers") pick.answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
    else pick.answer.reject(new Error("details failed"));
    await settle();

    assert.equal(field.input.value, "12 rue de Siam");
    assert.deepEqual(field.state.current, {
      address: "12 rue de Siam",
      latitude: null,
      longitude: null,
    });
  });
}

test("a picked suggestion answering after another pick writes nothing", async () => {
  const field = renderField();
  unmount = field.unmount;

  await showSuggestions(field, "8 quai", [
    suggestion("brest", "8 Quai de la Douane, Brest"),
    suggestion("lorient", "8 Quai des Indes, Lorient"),
  ]);
  pointerClick(field.option("brest"));
  pointerClick(field.option("lorient"));
  await tick(BLUR_DELAY);

  const [first, second] = field.resolves;
  second.answer.resolve(details("lorient", "8 Quai des Indes, Lorient"));
  await settle();
  first.answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
  await settle();

  assert.equal(field.input.value, "8 Quai des Indes, Lorient");
  assert.equal(field.state.current.address, "8 Quai des Indes, Lorient");
});

test("a typed-text lookup answering after the text was edited writes nothing", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai de la douane");
  blur(field.input);
  await tick(BLUR_DELAY);
  focus(field.input);
  typeInto(field.input, "12 rue de Siam");
  field.resolves[0].answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
  await settle();

  assert.equal(field.input.value, "12 rue de Siam");
  assert.deepEqual(field.state.current, {
    address: "12 rue de Siam",
    latitude: null,
    longitude: null,
  });
});

test("a typed-text lookup answering after a newer one writes nothing", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai de la douane");
  blur(field.input);
  await tick(BLUR_DELAY);
  focus(field.input);
  typeInto(field.input, "12 rue de Siam");
  blur(field.input);
  await tick(BLUR_DELAY);

  const [older, newer] = field.resolves;
  newer.answer.resolve(details("siam", "12 Rue de Siam, Brest"));
  await settle();
  older.answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
  await settle();

  assert.equal(field.input.value, "12 Rue de Siam, Brest");
  assert.equal(field.state.current.address, "12 Rue de Siam, Brest");
});

test("leaving with text too short to look up keeps the pending search's spinner", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai");
  await tick(SEARCH_DELAY);
  assert.equal(field.isSpinning(), true);

  typeInto(field.input, "8");
  blur(field.input);
  await tick(SEARCH_DELAY);
  assert.equal(field.resolves.length, 0);
  assert.equal(field.isSpinning(), true);

  field.searches[0].answer.resolve([]);
  await settle();
  assert.equal(field.isSpinning(), false);
});

for (const outcome of ["answers", "fails"] as const) {
  test(`a superseded pick that ${outcome} leaves the newer request's spinner on`, async () => {
    const field = renderField();
    unmount = field.unmount;

    await showSuggestions(field, "8 quai", [suggestion("brest", "8 Quai de la Douane, Brest")]);
    pointerClick(field.option("brest"));
    await tick(BLUR_DELAY);
    focus(field.input);
    typeInto(field.input, "12 rue de Siam");
    await tick(SEARCH_DELAY);
    assert.equal(field.searches.length, 2);

    const pick = field.resolves[0];
    if (outcome === "answers") pick.answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
    else pick.answer.reject(new Error("details failed"));
    await settle();
    assert.equal(field.isSpinning(), true);

    field.searches[1].answer.resolve([]);
    await settle();
    assert.equal(field.isSpinning(), false);
  });
}

test("Enter in the delivery field with the list closed resolves the typed text", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai de la douane");
  pressKey(field.input, "Enter");
  await settle();

  assert.deepEqual(
    field.resolves.map((resolve) => resolve.query),
    ["8 quai de la douane"],
  );
});

test("a search answering after the text changed shows no list", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai");
  await tick(SEARCH_DELAY);
  typeInto(field.input, "12 rue de Siam");
  field.searches[0].answer.resolve([suggestion("brest", "8 Quai de la Douane, Brest")]);
  await settle();

  assert.deepEqual(field.shownSuggestions(), []);
});

for (const outcome of ["answers", "fails"] as const) {
  test(`an older search that ${outcome} after a newer one leaves the newer list as it is`, async () => {
    const field = renderField();
    unmount = field.unmount;

    typeInto(field.input, "8 quai");
    await tick(SEARCH_DELAY);
    typeInto(field.input, "12 rue de Siam");
    await tick(SEARCH_DELAY);
    const [older, newer] = field.searches;
    assert.equal(newer.query, "12 rue de Siam");
    newer.answer.resolve([suggestion("siam", "12 Rue de Siam, Brest")]);
    await settle();
    if (outcome === "answers")
      older.answer.resolve([suggestion("brest", "8 Quai de la Douane, Brest")]);
    else older.answer.reject(new Error("search failed"));
    await settle();

    assert.deepEqual(field.shownSuggestions(), ["siam"]);
    assert.equal(field.input.value, "12 rue de Siam");
  });
}

for (const outcome of ["answers", "fails"] as const) {
  test(`a pick that ${outcome} after its field unmounted writes nothing to the new one`, async () => {
    const field = renderField();
    unmount = field.unmount;

    await showSuggestions(field, "8 quai", [suggestion("brest", "8 Quai de la Douane, Brest")]);
    pointerClick(field.option("brest"));
    await tick(BLUR_DELAY);
    field.remount();
    typeInto(field.input, "12 rue de Siam");

    const pick = field.resolves[0];
    if (outcome === "answers") pick.answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
    else pick.answer.reject(new Error("details failed"));
    await settle();

    assert.equal(field.input.value, "12 rue de Siam");
    assert.deepEqual(field.state.current, {
      address: "12 rue de Siam",
      latitude: null,
      longitude: null,
    });
  });
}

test("a typed-text lookup answering after its field unmounted writes nothing", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai de la douane");
  blur(field.input);
  await tick(BLUR_DELAY);
  field.remount();
  typeInto(field.input, "12 rue de Siam");
  field.resolves[0].answer.resolve(details("brest", "8 Quai de la Douane, Brest"));
  await settle();

  assert.equal(field.input.value, "12 rue de Siam");
  assert.equal(field.state.current.address, "12 rue de Siam");
});

test("a blur whose delay ends after the field unmounted looks nothing up", async () => {
  const field = renderField();
  unmount = field.unmount;

  typeInto(field.input, "8 quai de la douane");
  blur(field.input);
  field.hide();
  await tick(BLUR_DELAY);

  assert.deepEqual(field.resolves, []);
  assert.equal(field.state.current.address, "8 quai de la douane");
});

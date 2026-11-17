import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act, useState } from "react";
import { useStore } from "@tanstack/react-form";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import type { AddressDetails, AddressSuggestion } from "@louez/types";

import { useAppForm } from "@/hooks/form/form";
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
import messages from "@/messages/fr.json";

import {
  type CustomerAddressFields,
  type CustomerAddressPick,
  getPickedCoordinates,
} from "../util.customer-address";
import { checkoutFormOptions } from "../validator.checkout";
import { CheckoutAddressFields } from "./checkout-address-fields";

// The customer's own address at checkout, mounted as the contact step mounts
// it: what the customer typed is what is saved. A suggestion fills the street,
// the postal code and the city only when the customer picks it, and its
// coordinates hold only while the three fields hold what it filled.

const SEARCH_DELAY = 300;
const BLUR_DELAY = 120;

const voltaire: AddressDetails = {
  placeId: "voltaire",
  formattedAddress: "2 Rue Voltaire, 93400 Saint-Ouen-sur-Seine, France",
  latitude: 48.91,
  longitude: 2.33,
  streetNumber: "2",
  street: "Rue Voltaire",
  postalCode: "93400",
  city: "Saint-Ouen-sur-Seine",
};
const voltaireSuggestion: AddressSuggestion = {
  placeId: "voltaire",
  description: "2 Rue Voltaire, Saint-Ouen-sur-Seine",
  mainText: "2 Rue Voltaire",
  secondaryText: "Saint-Ouen-sur-Seine",
};

type Answer = ReturnType<typeof deferred<unknown>>;

/** The address endpoints, answered by the test when it chooses. */
const controlledQueryClient = () => {
  const requests: Array<{ endpoint: "autocomplete" | "details"; answer: Answer }> = [];
  const queryClient = new QueryClient();
  queryClient.fetchQuery = ((options: { queryKey: unknown }) => {
    const key = JSON.stringify(options.queryKey);
    const endpoint = (["autocomplete", "details"] as const).find((name) =>
      key.includes(`"${name}"`),
    );
    assert.ok(endpoint, `unexpected query ${key}`);
    const answer = deferred<unknown>();
    requests.push({ endpoint, answer });
    return answer.promise;
  }) as unknown as typeof queryClient.fetchQuery;
  return { queryClient, requests };
};

interface Snapshot {
  values: CustomerAddressFields;
  coordinates: ReturnType<typeof getPickedCoordinates>;
}

interface Controls {
  /** What a customer session change does: the pick forgotten, the form reset. */
  reset: (fields: CustomerAddressFields) => void;
  /** Leaves the contact step (the fields unmount) or comes back to it. */
  setShown: (shown: boolean) => void;
}

/** The form and the pick live above the fields, as the checkout keeps them across steps. */
const AddressFields = ({
  snapshot,
  controls,
}: {
  snapshot: { current: Snapshot };
  controls: Controls;
}) => {
  // As the checkout does, the form's defaults follow the customer it was reset for.
  const [defaultValues, setDefaultValues] = useState(checkoutFormOptions.defaultValues);
  const form = useAppForm({ ...checkoutFormOptions, defaultValues });
  const [pick, setPick] = useState<CustomerAddressPick | null>(null);
  const [shown, setShown] = useState(true);
  controls.setShown = setShown;
  controls.reset = (fields) => {
    const values = { ...form.state.values, ...fields };
    setDefaultValues(values);
    setPick(null);
    form.reset(values);
  };
  const address = useStore(form.store, (state) => state.values.address);
  const postalCode = useStore(form.store, (state) => state.values.postalCode);
  const city = useStore(form.store, (state) => state.values.city);
  const values = { address, postalCode, city };
  // What the checkout hands the delivery step: the coordinates of the pick
  // while the address still is the picked one.
  snapshot.current = { values, coordinates: getPickedCoordinates(pick, values) };
  return (
    <form.AppForm>
      {shown && <CheckoutAddressFields form={form} pick={pick} onPickChange={setPick} />}
    </form.AppForm>
  );
};

const renderAddress = () => {
  const { queryClient, requests } = controlledQueryClient();
  const snapshot = {
    current: {
      values: { address: "", postalCode: "", city: "" },
      coordinates: { latitude: null, longitude: null },
    } as Snapshot,
  };
  const controls: Controls = { reset: () => {}, setShown: () => {} };
  const view = mount(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="fr" messages={messages}>
        <AddressFields snapshot={snapshot} controls={controls} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  const byId = (id: string) =>
    view.container.querySelector(`#${id}`) as unknown as HTMLInputElement;
  const lookups = () =>
    requests.filter((request) => request.endpoint !== "autocomplete").map((r) => r.endpoint);
  return {
    ...view,
    requests,
    snapshot,
    lookups,
    reset: (fields: CustomerAddressFields) => act(() => controls.reset(fields)),
    remount: () => {
      act(() => controls.setShown(false));
      act(() => controls.setShown(true));
    },
    get street() {
      return byId("address");
    },
    get postalCode() {
      return byId("postalCode");
    },
    get city() {
      return byId("city");
    },
  };
};

type AddressView = ReturnType<typeof renderAddress>;

const typeAddress = (view: AddressView, fields: CustomerAddressFields) => {
  typeInto(view.street, fields.address);
  typeInto(view.postalCode, fields.postalCode);
  typeInto(view.city, fields.city);
};

/** Types in the street, answers the search with Voltaire and clicks it; its details stay pending. */
const startPick = async (view: AddressView) => {
  typeInto(view.street, "2 rue volt");
  await tick(SEARCH_DELAY);
  const search = view.requests.findLast((request) => request.endpoint === "autocomplete");
  search?.answer.resolve({ suggestions: [voltaireSuggestion] });
  await settle();
  const option = document.querySelector(
    '[data-address-suggestion="voltaire"]',
  ) as unknown as HTMLElement;
  pointerClick(option);
  await tick(BLUR_DELAY);
  const details = view.requests.findLast((request) => request.endpoint === "details");
  assert.ok(details, "picking asks the suggestion's details");
  return details.answer;
};

const pickVoltaire = async (view: AddressView) => {
  (await startPick(view)).resolve({ details: voltaire });
  await settle();
};

const PICKED = { address: "2 Rue Voltaire", postalCode: "93400", city: "Saint-Ouen-sur-Seine" };
const TYPED = { address: "2 rue du Test", postalCode: "75001", city: "Paris" };
const NO_COORDINATES = { latitude: null, longitude: null };

let unmount: (() => void) | null = null;
beforeEach(() => enableMockTimers());
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  mock.timers.reset();
});

test("without a pick, leaving the street, Tab and Enter keep what the customer typed", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  typeAddress(view, TYPED);
  focus(view.street);
  blur(view.street);
  await tick(BLUR_DELAY);
  focus(view.street);
  pressKey(view.street, "Enter");
  pressKey(view.street, "Tab");
  blur(view.street);
  await tick(BLUR_DELAY);

  assert.deepEqual(view.lookups(), []);
  assert.deepEqual(view.snapshot.current.values, TYPED);
  assert.equal(view.street.value, TYPED.address);
});

test("a suggestion list arriving after the customer moved on writes no field", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  typeInto(view.street, TYPED.address);
  await tick(SEARCH_DELAY);
  blur(view.street);
  await tick(BLUR_DELAY);
  typeInto(view.postalCode, TYPED.postalCode);
  typeInto(view.city, TYPED.city);
  view.requests[0].answer.resolve({ suggestions: [voltaireSuggestion] });
  await settle();

  assert.deepEqual(view.lookups(), []);
  assert.deepEqual(view.snapshot.current.values, TYPED);
});

test("the street's suggestions still show when the postal code was typed while they were searched", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  typeInto(view.street, "2 rue volt");
  await tick(SEARCH_DELAY);
  typeInto(view.postalCode, "93400");
  view.requests
    .findLast((request) => request.endpoint === "autocomplete")
    ?.answer.resolve({ suggestions: [voltaireSuggestion] });
  await settle();

  assert.ok(
    document.querySelector('[data-address-suggestion="voltaire"]'),
    "the suggestion for the street the field still shows is offered",
  );
  assert.equal(view.postalCode.value, "93400");
});

test("picking a suggestion fills the street, the postal code and the city", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  await pickVoltaire(view);

  assert.deepEqual(view.snapshot.current.values, PICKED);
  assert.equal(view.street.value, PICKED.address);
  assert.equal(view.postalCode.value, PICKED.postalCode);
  assert.equal(view.city.value, PICKED.city);
  assert.deepEqual(view.snapshot.current.coordinates, { latitude: 48.91, longitude: 2.33 });
});

for (const outcome of ["answers", "fails"] as const) {
  test(`a pick that ${outcome} after the customer typed another address writes nothing`, async () => {
    const view = renderAddress();
    unmount = view.unmount;

    const details = await startPick(view);
    focus(view.street);
    typeAddress(view, TYPED);
    if (outcome === "answers") details.resolve({ details: voltaire });
    else details.reject(new Error("details failed"));
    await settle();

    assert.deepEqual(view.snapshot.current.values, TYPED);
    assert.equal(view.street.value, TYPED.address);
    assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
  });
}

for (const [changed, edit] of [
  ["the postal code", (view: AddressView) => typeInto(view.postalCode, "75001")],
  ["the city", (view: AddressView) => typeInto(view.city, "Paris")],
] as const) {
  test(`the picked coordinates are dropped once ${changed} differs from the pick`, async () => {
    const view = renderAddress();
    unmount = view.unmount;

    await pickVoltaire(view);
    edit(view);

    assert.equal(view.snapshot.current.values.address, PICKED.address);
    assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
  });
}

test("editing the street clears the postal code and the city the pick filled", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  await pickVoltaire(view);
  typeInto(view.street, "4 Rue Voltaire");

  assert.deepEqual(view.snapshot.current.values, {
    address: "4 Rue Voltaire",
    postalCode: "",
    city: "",
  });
  assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
});

test("editing the street keeps a postal code and a city the customer corrected", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  await pickVoltaire(view);
  typeInto(view.postalCode, "93401");
  typeInto(view.city, "Saint-Ouen");
  typeInto(view.street, "4 Rue Voltaire");

  assert.deepEqual(view.snapshot.current.values, {
    address: "4 Rue Voltaire",
    postalCode: "93401",
    city: "Saint-Ouen",
  });
});

test("a password manager filling the locality, then the street, after a pick keeps its values", async () => {
  const view = renderAddress();
  unmount = view.unmount;

  await pickVoltaire(view);
  // A password manager fills each field with an input event, the locality first.
  typeInto(view.postalCode, TYPED.postalCode);
  typeInto(view.city, TYPED.city);
  typeInto(view.street, TYPED.address);
  blur(view.street);
  await tick(BLUR_DELAY);

  assert.deepEqual(view.snapshot.current.values, TYPED);
  assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
});

const STARTED = "2 rue volt";

for (const [edited, edit, expected] of [
  [
    "the postal code",
    (view: AddressView) => typeInto(view.postalCode, "75001"),
    { address: STARTED, postalCode: "75001", city: "" },
  ],
  [
    "the city",
    (view: AddressView) => typeInto(view.city, "Paris"),
    { address: STARTED, postalCode: "", city: "Paris" },
  ],
] as const) {
  for (const outcome of ["answers", "fails"] as const) {
    test(`a pick that ${outcome} after ${edited} was typed writes nothing`, async () => {
      const view = renderAddress();
      unmount = view.unmount;

      const details = await startPick(view);
      edit(view);
      if (outcome === "answers") details.resolve({ details: voltaire });
      else details.reject(new Error("details failed"));
      await settle();

      assert.deepEqual(view.snapshot.current.values, expected);
      assert.equal(view.street.value, STARTED);
      assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
    });
  }
}

for (const outcome of ["answers", "fails"] as const) {
  test(`a pick that ${outcome} after a reset with the same street writes nothing`, async () => {
    const view = renderAddress();
    unmount = view.unmount;

    const details = await startPick(view);
    const saved = { address: STARTED, postalCode: "29200", city: "Brest" };
    view.reset(saved);
    if (outcome === "answers") details.resolve({ details: voltaire });
    else details.reject(new Error("details failed"));
    await settle();

    assert.deepEqual(view.snapshot.current.values, saved);
    assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
  });
}

for (const outcome of ["answers", "fails"] as const) {
  test(`a pick that ${outcome} after the contact step was left and opened again writes nothing`, async () => {
    const view = renderAddress();
    unmount = view.unmount;

    const details = await startPick(view);
    view.remount();
    typeAddress(view, TYPED);
    if (outcome === "answers") details.resolve({ details: voltaire });
    else details.reject(new Error("details failed"));
    await settle();

    assert.deepEqual(view.snapshot.current.values, TYPED);
    assert.equal(view.street.value, TYPED.address);
    assert.deepEqual(view.snapshot.current.coordinates, NO_COORDINATES);
  });
}

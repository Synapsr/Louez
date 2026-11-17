import assert from "node:assert/strict";
import test from "node:test";

import type { AddressDetails } from "@louez/types";

import { resolveTypedText } from "@/components/ui/util.address-input";

import {
  CUSTOMER_ADDRESS_RESOLVES_TYPED_TEXT,
  getCustomerAddressFields,
} from "./util.customer-address";

const baseDetails = {
  placeId: "place-1",
  formattedAddress: "8 Quai de la Douane, 29200 Brest, France",
  latitude: 48.383,
  longitude: -4.49,
} satisfies AddressDetails;

test("uses the street line and pre-fills the postal code and city", () => {
  assert.deepEqual(
    getCustomerAddressFields({
      ...baseDetails,
      streetNumber: "8",
      street: "Quai de la Douane",
      postalCode: "29200",
      city: "Brest",
    }),
    {
      address: "8 Quai de la Douane",
      postalCode: "29200",
      city: "Brest",
    },
  );
});

test("falls back to the formatted address and clears unavailable locality fields", () => {
  assert.deepEqual(getCustomerAddressFields(baseDetails), {
    address: "8 Quai de la Douane, 29200 Brest, France",
    postalCode: "",
    city: "",
  });
});

// The customer's own address at checkout: what was typed is what is saved.
const typed = { address: "2 rue du Test", postalCode: "75001", city: "Paris" };
const otherAddress = {
  placeId: "place-voltaire",
  formattedAddress: "2 Rue Voltaire, 93400 Saint-Ouen-sur-Seine, France",
  latitude: 48.91,
  longitude: 2.33,
  streetNumber: "2",
  street: "Rue Voltaire",
  postalCode: "93400",
  city: "Saint-Ouen-sur-Seine",
} satisfies AddressDetails;

type AddressForm = { values: typeof typed };

/** The customer leaves the street field: a resolved address replaces the three fields, as the field applies it. */
const leaveStreetField = async (
  form: AddressForm,
  lookup: (query: string) => Promise<AddressDetails | null>,
) => {
  const details = await resolveTypedText(
    {
      resolvesTypedText: CUSTOMER_ADDRESS_RESOLVES_TYPED_TEXT,
      text: form.values.address,
      displayAddress: form.values.address,
      hasCoordinates: false,
      disabled: false,
    },
    lookup,
  ).catch(() => null);
  if (details) form.values = getCustomerAddressFields(details);
};

test("leaving the street field keeps the typed address when the lookup answers another one", async () => {
  const form = { values: typed };
  const queries: string[] = [];
  await leaveStreetField(form, async (query) => {
    queries.push(query);
    return otherAddress;
  });

  assert.deepEqual(form.values, typed);
  assert.deepEqual(queries, []);
});

test("leaving the street field keeps the typed address when the lookup fails", async () => {
  const form = { values: typed };
  const queries: string[] = [];
  await leaveStreetField(form, async (query) => {
    queries.push(query);
    throw new Error("lookup failed");
  });

  assert.deepEqual(form.values, typed);
  // Nothing is looked up, so no spinner and no error on a field left as typed.
  assert.deepEqual(queries, []);
});

test("a lookup answering after the customer moved on changes nothing they typed", async () => {
  const form = { values: typed };
  let answer: (details: AddressDetails) => void = () => {};
  const late = new Promise<AddressDetails>((resolve) => {
    answer = resolve;
  });

  const leaving = leaveStreetField(form, () => late);
  // The customer moves on to the postal code and corrects it by hand.
  form.values = { ...form.values, postalCode: "75002" };
  answer(otherAddress);
  await leaving;

  assert.deepEqual(form.values, { ...typed, postalCode: "75002" });
});

test("picking a suggestion fills the street, the postal code and the city", () => {
  assert.deepEqual(getCustomerAddressFields(otherAddress), {
    address: "2 Rue Voltaire",
    postalCode: "93400",
    city: "Saint-Ouen-sur-Seine",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import type { AddressDetails } from "@louez/types";

import { resolveTypedText } from "./util.address-input";

const otherAddress = {
  placeId: "place-voltaire",
  formattedAddress: "2 Rue Voltaire, 93400 Saint-Ouen-sur-Seine, France",
  latitude: 48.91,
  longitude: 2.33,
} satisfies AddressDetails;

const typedField = {
  text: "2 rue du Test",
  displayAddress: "2 rue du Test",
  hasCoordinates: false,
  disabled: false,
};

const recordingLookup = (answer: () => Promise<AddressDetails | null>) => {
  const queries: string[] = [];
  return {
    queries,
    lookup: (query: string) => {
      queries.push(query);
      return answer();
    },
  };
};

// The delivery address (checkout, dashboard) needs coordinates to price the
// distance: leaving it still replaces the typed text by the lookup's best match.
test("a field that resolves typed text takes the lookup's best match when it is left", async () => {
  const { queries, lookup } = recordingLookup(async () => otherAddress);

  const details = await resolveTypedText({ ...typedField, resolvesTypedText: true }, lookup);

  assert.deepEqual(queries, ["2 rue du Test"]);
  assert.deepEqual(details, otherAddress);
});

test("a field that resolves typed text skips the lookup when nothing new was typed", async () => {
  const { queries, lookup } = recordingLookup(async () => otherAddress);

  for (const field of [
    { ...typedField, text: "2 " },
    { ...typedField, disabled: true },
    { ...typedField, hasCoordinates: true },
  ]) {
    assert.equal(await resolveTypedText({ ...field, resolvesTypedText: true }, lookup), null);
  }
  assert.deepEqual(queries, []);
});

test("a field that resolves typed text passes a failed lookup on to the field", async () => {
  const { lookup } = recordingLookup(async () => {
    throw new Error("lookup failed");
  });

  await assert.rejects(resolveTypedText({ ...typedField, resolvesTypedText: true }, lookup));
});

test("a field that keeps typed text never looks it up when it is left", async () => {
  const { queries, lookup } = recordingLookup(async () => otherAddress);

  assert.equal(await resolveTypedText({ ...typedField, resolvesTypedText: false }, lookup), null);
  assert.deepEqual(queries, []);
});

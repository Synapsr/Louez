import assert from "node:assert/strict";
import { test } from "node:test";

import { STORE_NOT_ACCEPTING_RESERVATIONS_ERROR } from "@louez/types";

import { describePhoneQuoteError } from "./errors";

// What the phone receptionist tells a caller when the card gate refuses the booking
// (louez-billing docs/api, README §8.4): its own sentence in every spoken language,
// with no billing reason.

const LANGUAGES = ["fr", "en", "de", "es", "it", "nl", "pl", "pt"];

test("a closed card gate has its own sentence in every language, never the default", () => {
  for (const language of LANGUAGES) {
    const sentence = describePhoneQuoteError(
      STORE_NOT_ACCEPTING_RESERVATIONS_ERROR,
      undefined,
      language,
    );
    assert.notEqual(sentence, describePhoneQuoteError(undefined, undefined, language), language);
    assert.doesNotMatch(sentence, /billing|factur|card|carte|paiement|payment/i, language);
  }
});

test("an unknown language speaks English", () => {
  assert.equal(
    describePhoneQuoteError(STORE_NOT_ACCEPTING_RESERVATIONS_ERROR, undefined, "ja"),
    describePhoneQuoteError(STORE_NOT_ACCEPTING_RESERVATIONS_ERROR, undefined, "en"),
  );
});

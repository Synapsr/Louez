import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiServiceError } from "@louez/api/services";

import { bookingServiceError } from "./booking-api-route";

// The booking API's answer when the card gate refuses a hold (louez-billing docs/api,
// README §8.4): 409 with a code the marketplace can read, and no billing reason.

test("a hold the card gate refused answers 409 store_not_accepting_reservations", async () => {
  const response = bookingServiceError(
    new ApiServiceError("BAD_REQUEST", "store_not_accepting_reservations"),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "store_not_accepting_reservations" });
});

test("an unknown bad request still answers 400 with its key", async () => {
  const response = bookingServiceError(new ApiServiceError("BAD_REQUEST", "errors.invalidData"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "errors.invalidData" });
});

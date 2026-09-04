import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewBoosterSettings } from "@louez/types";

import type { PlaceDetails } from "./index";
import { mergeCurrentPlaceDetails } from "./util.place-summary";

const settings: ReviewBoosterSettings = {
  enabled: true,
  googlePlaceId: "place-1",
  googlePlaceName: "Old name",
  googlePlaceAddress: "Old address",
  googleRating: 5,
  googleReviewCount: 24,
  displayReviewsOnStorefront: true,
  showReviewPromptInPortal: true,
  autoSendThankYouEmail: false,
  autoSendThankYouSms: false,
  emailDelayHours: 24,
  smsDelayHours: 24,
};

const details: PlaceDetails = {
  placeId: "place-1",
  name: "Current name",
  address: "Current address",
  rating: 4.9,
  reviewCount: 30,
  reviews: [],
  mapsUrl: "https://example.com/place-1",
};

test("uses the current Google summary while preserving feature settings", () => {
  assert.deepEqual(mergeCurrentPlaceDetails(settings, details), {
    ...settings,
    googlePlaceName: "Current name",
    googlePlaceAddress: "Current address",
    googleRating: 4.9,
    googleReviewCount: 30,
  });
});

test("ignores details belonging to another place", () => {
  assert.equal(mergeCurrentPlaceDetails(settings, { ...details, placeId: "place-2" }), settings);
});

test("keeps an unconfigured or unavailable place unchanged", () => {
  assert.equal(mergeCurrentPlaceDetails(settings, null), settings);
  assert.equal(mergeCurrentPlaceDetails(null, details), null);
});

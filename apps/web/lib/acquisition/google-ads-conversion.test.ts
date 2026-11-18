import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  adClickOf,
  MAX_CLICK_AGE_MS,
  MIN_CLICK_AGE_MS,
  pendingGoogleAdsConversion,
  UPLOAD_MARGIN_MS,
  uploadRetryDelayMs,
} from "./google-ads-conversion";

const CREATED = new Date("2026-11-18T10:00:00.000Z");
const HOUR = 3_600_000;

describe("adClickOf", () => {
  test("takes the gclid first, then the gbraid, then the wbraid", () => {
    assert.deepEqual(adClickOf({ gclid: "G", gbraid: "B", wbraid: "W" }), {
      type: "gclid",
      id: "G",
    });
    assert.deepEqual(adClickOf({ gbraid: "B", wbraid: "W" }), { type: "gbraid", id: "B" });
    assert.deepEqual(adClickOf({ wbraid: "W" }), { type: "wbraid", id: "W" });
  });

  test("a touch without a click id, or no touch, has no click", () => {
    assert.equal(adClickOf(null), null);
    // gad_source alone says Google Ads, but Google cannot match a conversion to it.
    assert.equal(adClickOf({ utm_source: "google", utm_medium: "cpc", gad_source: "1" }), null);
  });
});

describe("pendingGoogleAdsConversion", () => {
  test("an ad click owes a conversion, uploaded once the click is 6 hours old", () => {
    const clickedAt = new Date(CREATED.getTime() - HOUR);
    const pending = pendingGoogleAdsConversion({
      userId: "user_1",
      touch: { gclid: "EAIaIQobChMI", utm_source: "google", ts: clickedAt.toISOString() },
      convertedAt: CREATED,
    });
    assert.deepEqual(pending, {
      userId: "user_1",
      clickIdType: "gclid",
      clickId: "EAIaIQobChMI",
      clickedAt,
      convertedAt: CREATED,
      adUserDataConsent: "denied",
      adPersonalizationConsent: "denied",
      nextAttemptAt: new Date(clickedAt.getTime() + MIN_CLICK_AGE_MS + UPLOAD_MARGIN_MS),
    });
  });

  test("an account created more than 6 hours after its click is uploaded at the next run", () => {
    const pending = pendingGoogleAdsConversion({
      userId: "user_1",
      touch: { wbraid: "W", ts: new Date(CREATED.getTime() - 3 * 24 * HOUR).toISOString() },
      convertedAt: CREATED,
    });
    assert.equal(pending?.clickIdType, "wbraid");
    assert.deepEqual(pending?.nextAttemptAt, new Date(CREATED.getTime() + UPLOAD_MARGIN_MS));
  });

  test("no click id, no touch, or no click time: nothing is owed", () => {
    for (const touch of [null, {}, { utm_source: "google", ts: CREATED.toISOString() }]) {
      assert.equal(pendingGoogleAdsConversion({ userId: "u", touch, convertedAt: CREATED }), null);
    }
    // Without its time, the click's age, and so its 90 days, cannot be told.
    assert.equal(
      pendingGoogleAdsConversion({ userId: "u", touch: { gclid: "G" }, convertedAt: CREATED }),
      null,
    );
  });

  test("a click already past its 90 days owes nothing", () => {
    const ts = new Date(CREATED.getTime() - MAX_CLICK_AGE_MS).toISOString();
    assert.equal(
      pendingGoogleAdsConversion({ userId: "u", touch: { gclid: "G", ts }, convertedAt: CREATED }),
      null,
    );
  });

  test("a click dated after the account counts as made with it", () => {
    const pending = pendingGoogleAdsConversion({
      userId: "u",
      touch: { gclid: "G", ts: new Date(CREATED.getTime() + 5 * 60_000).toISOString() },
      convertedAt: CREATED,
    });
    assert.deepEqual(pending?.clickedAt, CREATED);
  });

  test("consent is denied unless the sign-up captured it", () => {
    const touch = { gclid: "G", ts: CREATED.toISOString() };
    const captured = pendingGoogleAdsConversion({
      userId: "u",
      touch,
      convertedAt: CREATED,
      consent: { adUserData: "granted", adPersonalization: "denied" },
    });
    assert.equal(captured?.adUserDataConsent, "granted");
    assert.equal(captured?.adPersonalizationConsent, "denied");
  });
});

test("a failed upload waits 15 min, then twice as long each time, at most a day", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 8, 20].map((attempts) => uploadRetryDelayMs(attempts) / 60_000),
    [15, 30, 60, 120, 1440, 1440],
  );
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { errorTrackingConfig } from "./error-tracking";

// Error tracking stays off unless production turns it on: development and
// tests send nothing, even with the analytics key set.

const enabled = {
  POSTHOG_ERROR_TRACKING_ENABLED: true,
  POSTHOG_ERROR_TRACKING_SAMPLE_RATE: 1,
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  NEXT_PUBLIC_APP_VERSION: "2026.11.10",
};

describe("error tracking configuration", () => {
  test("on with the flag and the key, with the release", () => {
    assert.deepEqual(errorTrackingConfig(enabled), {
      key: "phc_test",
      host: "https://eu.i.posthog.com",
      sampleRate: 1,
      release: "2026.11.10",
    });
  });

  test("off without the flag, even with the analytics key", () => {
    assert.equal(errorTrackingConfig({ ...enabled, POSTHOG_ERROR_TRACKING_ENABLED: false }), null);
  });

  test("off without the key", () => {
    assert.equal(errorTrackingConfig({ ...enabled, NEXT_PUBLIC_POSTHOG_KEY: undefined }), null);
  });

  test("off while `next build` prerenders", () => {
    assert.equal(errorTrackingConfig({ ...enabled, NEXT_PHASE: "phase-production-build" }), null);
  });
});

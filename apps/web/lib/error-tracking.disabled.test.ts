import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// An instance without error tracking sends nothing, even with the analytics key
// set and a storefront failing: the flag is the raw "false" that
// SKIP_ENV_VALIDATION hands over.

describe("error tracking turned off", () => {
  closeNetworkForSuite();
  let errorTracking: typeof import("./error-tracking");

  before(async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    process.env.POSTHOG_ERROR_TRACKING_ENABLED = "false";
    errorTracking = await import("./error-tracking");
  });

  test("a storefront's render error sends nothing", async () => {
    const calls: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return new Response("{}", { status: 200 });
    };
    try {
      const { reportServerError, requestErrorContext } = errorTracking;
      const request = { path: "/about", headers: { "x-store-slug": "velo-brest" } };
      const route = { routePath: "/(storefront)/[slug]/about/page", routeType: "render" } as const;
      reportServerError(new TypeError("d.ranges is not iterable"), requestErrorContext(request, route));
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(calls, []);
  });
});

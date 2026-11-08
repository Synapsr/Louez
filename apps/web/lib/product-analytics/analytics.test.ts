import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, describe, test } from "node:test";

// The outbox's analytics sender: PostHog's answer decides the row's outcome.
// A 503 fails it (the SDK's flush would have swallowed it), no key skips it.

const directory = mkdtempSync(join(tmpdir(), "louez-analytics-"));
const envPath = join(directory, "env.cjs");
writeFileSync(envPath, "module.exports = { env: globalThis.__louezAnalyticsEnv };");
after(() => rmSync(directory, { recursive: true }));

const testEnv: Record<string, string | undefined> = {
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
  NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example.test/",
};
Reflect.set(globalThis, "__louezAnalyticsEnv", testEnv);

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const parent = context.parentURL ?? "";
    if (specifier === "@/env" && parent.includes("product-analytics/analytics.ts")) {
      return { url: pathToFileURL(envPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

describe("strict analytics capture", () => {
  let analytics: typeof import("./analytics");
  const realFetch = globalThis.fetch;
  let requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let status = 200;

  before(async () => {
    analytics = await import("./analytics");
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(status < 300 ? "{}" : "unavailable", { status });
    }) as typeof fetch;
  });

  afterEach(() => {
    requests = [];
    status = 200;
    testEnv.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  const event = {
    distinctId: "owner",
    storeId: "store",
    reservationId: "res",
    action: "cancel_reservation" as const,
    properties: { status_after: "cancelled" },
  };

  test("a delivered event resolves, sent to PostHog's capture API", async () => {
    assert.equal(await analytics.captureReservationActionSucceededOrThrow(event), undefined);
    assert.equal(requests[0]?.url, "https://posthog.example.test/i/v0/e/");
    assert.equal(requests[0]?.body.api_key, "phc_test");
    assert.equal(requests[0]?.body.distinct_id, "owner");
  });

  test("a 503 throws, so the outbox retries it", async () => {
    status = 503;
    await assert.rejects(
      analytics.captureReservationActionSucceededOrThrow(event),
      /PostHog answered 503/,
    );
  });

  test("without a key, the event is skipped, not failed", async () => {
    testEnv.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    assert.deepEqual(await analytics.captureReservationActionSucceededOrThrow(event), {
      skipped: "analytics is not set up",
    });
    assert.equal(requests.length, 0);
  });
});

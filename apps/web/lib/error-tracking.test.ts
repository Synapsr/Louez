import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { PostHog, type PostHogOptions } from "posthog-node";

import {
  createErrorTrackingClient,
  createPostHogErrorReporter,
  errorTrackingConfig,
  isFlagOn,
  parseSampleRate,
  requestErrorContext,
  sanitizeExceptionEvent,
  type ErrorTrackingConfig,
} from "./error-tracking";

// Error tracking stays off unless production turns it on, and what leaves is
// the sanitized event: no source line, no absolute path, no secret.

const enabled = {
  POSTHOG_ERROR_TRACKING_ENABLED: "true",
  POSTHOG_ERROR_TRACKING_SAMPLE_RATE: "1",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  NEXT_PUBLIC_APP_VERSION: "2026.11.10",
};

describe("error tracking configuration", () => {
  test("on with an explicit flag and the key, with the release", () => {
    assert.deepEqual(errorTrackingConfig(enabled), {
      key: "phc_test",
      host: "https://eu.i.posthog.com",
      sampleRate: 1,
      release: "2026.11.10",
    });
    assert.notEqual(errorTrackingConfig({ ...enabled, POSTHOG_ERROR_TRACKING_ENABLED: "1" }), null);
  });

  test("off for a raw flag that is not true, as SKIP_ENV_VALIDATION hands it over", () => {
    for (const flag of ["false", "FALSE", "0", "", " ", "no", "yes", undefined, false]) {
      assert.equal(isFlagOn(flag), false, String(flag));
      assert.equal(errorTrackingConfig({ ...enabled, POSTHOG_ERROR_TRACKING_ENABLED: flag }), null);
    }
    for (const flag of ["true", "TRUE", " true ", "1", true]) assert.equal(isFlagOn(flag), true);
  });

  test("off without the key, and while `next build` prerenders", () => {
    assert.equal(errorTrackingConfig({ ...enabled, NEXT_PUBLIC_POSTHOG_KEY: undefined }), null);
    assert.equal(errorTrackingConfig({ ...enabled, NEXT_PHASE: "phase-production-build" }), null);
  });

  test("a sample rate out of range or unreadable sends everything", () => {
    assert.equal(parseSampleRate("0.25"), 0.25);
    assert.equal(parseSampleRate(0), 0);
    for (const rate of ["", "abc", "2", "-1", undefined]) assert.equal(parseSampleRate(rate), 1);
  });
});

describe("the event as sent", () => {
  test("an exception keeps its class, the reporter's text and frames in the repository only", () => {
    const event = sanitizeExceptionEvent({
      event: "$exception",
      distinctId: "x",
      properties: {
        $exception_list: [
          {
            type: "Error jane-canary",
            value: "no customer jane@example.invalid",
            mechanism: { type: "generic", handled: true, synthetic: false },
            stacktrace: {
              type: "raw",
              frames: [
                {
                  filename: "apps/web/lib/a.ts",
                  module: "a.ts",
                  function: "loadFor_jane",
                  lineno: 3,
                  colno: 7,
                  in_app: true,
                  platform: "node:javascript",
                  pre_context: ["const key = 'sk_live_canary'"],
                  context_line: "throw new Error(secret)",
                  post_context: ["}"],
                },
                { filename: "/Users/someone/tmp/x.ts", lineno: 1, colno: 1 },
                { filename: "node:internal/process/task_queues", lineno: 1, colno: 1 },
              ],
            },
          },
          { type: "ZodError", value: "1 issue(s): custom at customer.name" },
        ],
      },
    });
    const text = JSON.stringify(event);
    for (const canary of ["jane", "sk_live_canary", "secret", "/Users/someone", "node:internal"]) {
      assert.doesNotMatch(text, new RegExp(canary));
    }
    assert.deepEqual(event?.properties?.$exception_list, [
      {
        type: "[name]",
        value: "[message withheld]",
        mechanism: { type: "generic", handled: true, synthetic: false },
        stacktrace: {
          type: "raw",
          frames: [
            {
              filename: "apps/web/lib/a.ts",
              function: "?",
              lineno: 3,
              colno: 7,
              in_app: true,
              platform: "node:javascript",
            },
          ],
        },
      },
      {
        type: "ZodError",
        value: "1 issue(s): custom at customer.name",
        mechanism: { type: "generic", handled: true, synthetic: false },
        stacktrace: { type: "raw", frames: [] },
      },
    ]);
  });

  test("only the reporter's properties, each in its own form", () => {
    const event = sanitizeExceptionEvent({
      event: "$exception",
      distinctId: "x",
      properties: {
        $exception_list: [],
        $exception_fingerprint: "not a fingerprint",
        error_code: "Bearer private-code-canary",
        procedure: "inbox.list for jane@example.invalid",
        route: "/api/v1/[[...path]]",
        store_id: "store-canary-V1StGXR8",
        http_status: 500,
        $process_person_profile: false,
        nested: { email: "jane@example.invalid" },
        unknown_property: "kept-canary",
      },
    });
    assert.deepEqual(event?.properties, {
      $exception_list: [],
      route: "/api/v1/[[...path]]",
      http_status: 500,
      $process_person_profile: false,
    });
    const kept = sanitizeExceptionEvent({
      event: "$exception",
      distinctId: "x",
      properties: {
        $exception_fingerprint: "0123456789abcdef0123456789abcdef",
        error_code: "ER_DUP_ENTRY",
      },
    });
    assert.deepEqual(kept?.properties, {
      $exception_fingerprint: "0123456789abcdef0123456789abcdef",
      error_code: "ER_DUP_ENTRY",
    });
  });

  test("only exceptions leave through this client", () => {
    assert.equal(sanitizeExceptionEvent({ event: "pageview", distinctId: "x" }), null);
  });

  test("a store's slug leaves with a storefront's error only, in its own form", () => {
    const sent = (properties: Record<string, unknown>) =>
      sanitizeExceptionEvent({ event: "$exception", distinctId: "x", properties })?.properties;
    assert.deepEqual(sent({ source: "storefront", store_slug: "velo-brest" }), {
      source: "storefront",
      store_slug: "velo-brest",
    });
    assert.deepEqual(sent({ source: "request", store_slug: "velo-brest" }), { source: "request" });
    // A route keeps its groups, as a background revalidation names it.
    assert.deepEqual(sent({ route: "/(storefront)/[slug]/(home)/page" }), {
      route: "/(storefront)/[slug]/(home)/page",
    });
    assert.deepEqual(sent({ store_slug: "velo-brest" }), {});
    assert.deepEqual(sent({ source: "storefront", store_slug: "jane@example.invalid" }), {
      source: "storefront",
    });
  });
});

describe("the context of an error Next caught in a request", () => {
  const about = { routePath: "/[slug]/about", routeType: "render" } as const;

  test("a storefront route on a store's own host: the store the proxy names", () => {
    const request = { path: "/about?ref=canary", headers: { "x-store-slug": "velo-brest" } };
    assert.deepEqual(requestErrorContext(request, about), {
      source: "storefront",
      route: "/[slug]/about",
      routeType: "render",
      storeSlug: "velo-brest",
    });
  });

  test("a storefront route by its path: its first segment, nothing else of the path", () => {
    const pay = { routePath: "/[slug]/pay/[reservationId]", routeType: "render" } as const;
    const request = { path: "/velo-brest/pay/res-canary?token=tok-canary", headers: {} };
    assert.deepEqual(requestErrorContext(request, pay), {
      source: "storefront",
      route: "/[slug]/pay/[reservationId]",
      routeType: "render",
      storeSlug: "velo-brest",
    });
    // A background revalidation names the route with its groups.
    const home = { routePath: "/(storefront)/[slug]/(home)/page", routeType: "action" } as const;
    assert.equal(requestErrorContext({ path: "/velo-brest", headers: {} }, home).storeSlug, "velo-brest");
  });

  test("a store header that is not one value names no store", () => {
    const request = { path: "/about", headers: { "x-store-slug": ["velo-brest", "ski-annecy"] } };
    const context = requestErrorContext(request, about);
    assert.equal(context.source, "storefront");
    assert.equal(context.storeSlug, undefined);
  });

  test("any other route is a request, with no store", () => {
    const request = { path: "/velo-brest/x", headers: { "x-store-slug": "velo-brest" } };
    for (const routePath of ["/api/mcp/route", "/(dashboard)/dashboard/page", "/demo/[vertical]/page"]) {
      assert.deepEqual(requestErrorContext(request, { routePath, routeType: "route" }), {
        source: "request",
        route: routePath,
        routeType: "route",
      });
    }
  });
});

describe("the client, with PostHog's network intercepted", () => {
  const directory = mkdtempSync(join(tmpdir(), "louez-error-tracking-"));
  after(() => rmSync(directory, { recursive: true }));
  const file = join(directory, "handler.js");
  writeFileSync(
    file,
    ["function handler() {", "  const card = 'CANARY_SOURCE_LINE';", "  throw boom;", "}"].join(
      "\n",
    ),
  );
  const config: ErrorTrackingConfig = {
    key: "phc_test",
    host: "https://ph.test",
    sampleRate: 1,
    release: undefined,
  };

  /** A thrown error whose frame points at the file holding the canary. */
  function thrownAtFile() {
    const error = new Error("boom");
    error.stack = `Error: boom\n    at handler (${file}:3:3)`;
    return error;
  }

  async function sentBody(client: PostHog) {
    client.captureException(thrownAtFile());
    await client.shutdown(2000);
  }

  function fakeNetwork() {
    const bodies: string[] = [];
    const fetch: PostHogOptions["fetch"] = async (_url, options) => {
      bodies.push(String(options.body));
      return { status: 200, text: async () => "{}", json: async () => ({}) };
    };
    return { bodies, fetch };
  }

  test("the SDK reads the source lines from disk: without the gate, they would leave", async () => {
    const { bodies, fetch } = fakeNetwork();
    const ungated = new PostHog(config.key, {
      host: config.host,
      flushAt: 1,
      flushInterval: 0,
      disableCompression: true,
      fetch,
    });
    await sentBody(ungated);
    assert.match(bodies.join(""), /CANARY_SOURCE_LINE/);
  });

  test("with the gate, neither the source lines nor the absolute path leave", async () => {
    const { bodies, fetch } = fakeNetwork();
    await sentBody(createErrorTrackingClient(config, { disableCompression: true, fetch }));
    const sent = bodies.join("");
    assert.match(sent, /\$exception/);
    assert.doesNotMatch(sent, /CANARY_SOURCE_LINE|context_line|pre_context/);
    assert.equal(sent.includes(directory), false);
  });
});

describe("the reporter, with PostHog's network intercepted", () => {
  const config: ErrorTrackingConfig = {
    key: "phc_test",
    host: "https://ph.test",
    sampleRate: 1,
    release: undefined,
  };

  /** A reporter on the real client, and the next body it sends. */
  function intercepted() {
    let resolve: (body: string) => void = () => {};
    const body = new Promise<string>((done) => (resolve = done));
    const fetch: PostHogOptions["fetch"] = async (_url, options) => {
      resolve(String(options.body));
      return { status: 200, text: async () => "{}", json: async () => ({}) };
    };
    return {
      report: createPostHogErrorReporter(config, { disableCompression: true, fetch }),
      body,
    };
  }

  const STORE = "store-canary-V1StGXR8";

  test("a validation error under a wrapper loses its message; an unsafe code and the store are dropped", async () => {
    const { report, body } = intercepted();
    const zod = Object.assign(new Error("custom message jane-canary"), {
      name: "ZodError",
      issues: [{ code: "custom", path: ["customer", "name"], message: "jane-canary" }],
    });
    const error = Object.assign(new Error("wrapper", { cause: zod }), {
      code: "Bearer private-code-canary",
    });
    // A store id would link the event to its owner: even handed one, nothing sends it.
    const context = { source: "procedure", procedure: "customers.create", storeId: STORE };
    report(error, context as Parameters<typeof report>[1]);
    const sent = await body;
    assert.doesNotMatch(sent, /jane-canary|private-code-canary/);
    assert.match(sent, /1 issue\(s\): custom at customer\.name/);
    assert.match(sent, /"procedure":"customers\.create"/);
    assert.doesNotMatch(sent, /"error_code"/);
    assert.doesNotMatch(sent, /store_id|storeId|store-canary-V1StGXR8/);
  });

  test("a storefront's render error leaves with its store, page and time, nothing personal", async () => {
    const { report, body } = intercepted();
    const request = {
      path: "/pay/res-canary?token=tok-canary&email=jane%40example.invalid",
      headers: {
        "x-store-slug": "velo-brest",
        cookie: "session=cookie-canary",
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "agent-canary",
      },
    };
    const route = { routePath: "/[slug]/pay/[reservationId]", routeType: "render" } as const;
    const before = Date.now();
    report(
      new TypeError("d.ranges is not iterable for jane@example.invalid"),
      requestErrorContext(request, route),
    );
    const sent = await body;
    const payload: unknown = JSON.parse(sent);
    const batch = typeof payload === "object" && payload ? Reflect.get(payload, "batch") : [];
    const event: unknown = Array.isArray(batch) ? batch[0] : undefined;
    assert.ok(typeof event === "object" && event);
    assert.equal(Reflect.get(event, "event"), "$exception");
    const properties: unknown = Reflect.get(event, "properties");
    assert.ok(typeof properties === "object" && properties);
    assert.equal(Reflect.get(properties, "source"), "storefront");
    assert.equal(Reflect.get(properties, "store_slug"), "velo-brest");
    assert.equal(Reflect.get(properties, "route"), "/[slug]/pay/[reservationId]");
    assert.equal(Reflect.get(properties, "route_type"), "render");
    assert.ok(Date.parse(String(Reflect.get(event, "timestamp"))) >= before - 1000);
    assert.doesNotMatch(
      sent,
      /jane|res-canary|tok-canary|cookie-canary|203\.0\.113\.7|agent-canary|store_id|storeId/,
    );
  });

  test("nothing listens for the process to stop: events leave as they are captured", () => {
    const events = ["SIGTERM", "SIGINT", "beforeExit", "exit"] as const;
    const before = events.map((name) => process.listenerCount(name));
    const { report } = intercepted();
    report(new Error("boom"), { source: "request" });
    assert.deepEqual(
      events.map((name) => process.listenerCount(name)),
      before,
    );
  });
});

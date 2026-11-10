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
  test("source lines are dropped, paths made relative, values sanitized", () => {
    const event = sanitizeExceptionEvent({
      event: "$exception",
      distinctId: "x",
      properties: {
        $exception_list: [
          {
            type: "Error",
            value: "no customer jane@example.invalid",
            stacktrace: {
              frames: [
                {
                  filename: "/Users/someone/Louez/apps/web/lib/a.ts",
                  abs_path: "/Users/someone/Louez/apps/web/lib/a.ts",
                  function: "load",
                  pre_context: ["const key = 'sk_live_canary'"],
                  context_line: "throw new Error(secret)",
                  post_context: ["}"],
                },
              ],
            },
          },
        ],
      },
    });
    const text = JSON.stringify(event);
    for (const canary of ["jane@example.invalid", "sk_live_canary", "secret", "/Users/someone"]) {
      assert.doesNotMatch(text, new RegExp(canary));
    }
    assert.match(text, /"filename":"apps\/web\/lib\/a\.ts"/);
  });

  test("every property kept is sanitized; a code or a fingerprint out of format is dropped", () => {
    const event = sanitizeExceptionEvent({
      event: "$exception",
      distinctId: "x",
      properties: {
        $exception_list: [],
        $exception_fingerprint: "not a fingerprint",
        error_code: "Bearer private-code-canary",
        procedure: "inbox.list for jane@example.invalid",
        http_status: 500,
        $process_person_profile: false,
        nested: { email: "jane@example.invalid" },
      },
    });
    assert.deepEqual(event?.properties, {
      $exception_list: [],
      procedure: "inbox.list for [redacted]",
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

  test("a validation error under a wrapper loses its message; an unsafe code is dropped", async () => {
    const { report, body } = intercepted();
    const zod = Object.assign(new Error("custom message jane-canary"), {
      name: "ZodError",
      issues: [{ code: "custom", path: ["customer", "name"], message: "jane-canary" }],
    });
    const error = Object.assign(new Error("wrapper", { cause: zod }), {
      code: "Bearer private-code-canary",
    });
    report(error, { source: "procedure", procedure: "customers.create" });
    const sent = await body;
    assert.doesNotMatch(sent, /jane-canary|private-code-canary/);
    assert.match(sent, /1 issue\(s\): custom at customer\.name/);
    assert.match(sent, /"procedure":"customers\.create"/);
    assert.doesNotMatch(sent, /"error_code"/);
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

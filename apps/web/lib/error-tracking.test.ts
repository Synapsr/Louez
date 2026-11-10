import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { PostHog, type PostHogOptions } from "posthog-node";

import {
  createErrorTrackingClient,
  errorTrackingConfig,
  flushOnSignals,
  isFlagOn,
  parseSampleRate,
  sanitizeExceptionEvent,
  type ErrorTrackingConfig,
  type SignalTarget,
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

  test("only exceptions leave through this client", () => {
    assert.equal(sanitizeExceptionEvent({ event: "pageview", distinctId: "x" }), null);
  });
});

describe("the client, with PostHog's network intercepted", () => {
  const directory = mkdtempSync(join(tmpdir(), "louez-error-tracking-"));
  after(() => rmSync(directory, { recursive: true }));
  const file = join(directory, "handler.js");
  writeFileSync(file, ["function handler() {", "  const card = 'CANARY_SOURCE_LINE';", "  throw boom;", "}"].join("\n"));
  const config: ErrorTrackingConfig = { key: "phc_test", host: "https://ph.test", sampleRate: 1, release: undefined };

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

describe("flushing when the process is told to stop", () => {
  function target(others: number) {
    const emitter = new EventEmitter();
    const kills: string[] = [];
    for (let index = 0; index < others; index += 1) emitter.on("SIGTERM", () => {});
    const fake: SignalTarget = {
      pid: 1,
      on: (signal, listener) => emitter.on(signal, listener),
      off: (signal, listener) => emitter.off(signal, listener),
      listenerCount: (signal) => emitter.listenerCount(signal),
      kill: (_pid, signal) => kills.push(signal),
    };
    return { emitter, kills, fake };
  }

  test("flushes once, and leaves the exit to Next's own listener", async () => {
    const { emitter, kills, fake } = target(1);
    let flushes = 0;
    flushOnSignals(async () => (flushes += 1), fake);
    emitter.emit("SIGTERM");
    emitter.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(flushes, 1);
    assert.deepEqual(kills, []);
    assert.equal(emitter.listenerCount("SIGINT"), 0);
  });

  test("alone, raises the signal again once flushed, so the process still stops", async () => {
    const { emitter, kills, fake } = target(0);
    flushOnSignals(async () => {
      throw new Error("network down");
    }, fake);
    emitter.emit("SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(kills, ["SIGTERM"]);
  });
});

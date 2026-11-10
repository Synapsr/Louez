import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { call, ORPCError, os } from "@orpc/server";

import type { BaseContext } from "../context";
import {
  createErrorThrottle,
  createServerErrorReporter,
  ERROR_HOURLY_CAP,
  ERROR_REPEAT_WINDOW_MS,
  isUnexpectedServerError,
  messageTemplate,
  prepareServerError,
  reportUnexpectedErrors,
  type ServerErrorContext,
  type ServerErrorProperties,
} from "./error-reporting";
import { apiError, platformErrors } from "./errors";
import { largeBodyBusy } from "./large-bodies";
import type { ApiPorts } from "./ports";

// What reaches error tracking: only faults, sanitized, a few per hour.

/** Stands for the app's sanitizer: e-mails out. */
const sanitize = (text: string) => text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");

function errorAt(message: string, frame: string, name = "Error"): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = `${name}: ${message}\n    at ${frame}\n    at run (/app/node_modules/lib/index.js:1:1)`;
  return error;
}

function recorder() {
  const sent: Array<{ error: Error; properties: ServerErrorProperties }> = [];
  return {
    sent,
    send: (error: Error, properties: ServerErrorProperties) => sent.push({ error, properties }),
  };
}

describe("which errors are sent", () => {
  test("refusals are the API working: never sent", () => {
    const refusals = [
      platformErrors.unauthenticated(),
      platformErrors.rateLimited(30),
      platformErrors.capabilityWithheldFromClient("products.enhanceImage"),
      platformErrors.withheldFromClient("billing"),
      apiError("PRECONDITION_FAILED", "CONFIRMATION_REQUIRED", { message: "Confirm." }),
      new ORPCError("NOT_FOUND", { message: "errors.productNotFound" }),
      new ORPCError("BAD_REQUEST", { message: "Input validation failed" }),
      largeBodyBusy(),
    ];
    for (const error of refusals)
      assert.equal(isUnexpectedServerError(error), false, error.message);
  });

  test("a 5xx or any other exception is a fault", () => {
    assert.equal(isUnexpectedServerError(new Error("boom")), true);
    assert.equal(isUnexpectedServerError(new TypeError("x is undefined")), true);
    assert.equal(isUnexpectedServerError("a string thrown"), true);
    assert.equal(isUnexpectedServerError(new ORPCError("INTERNAL_SERVER_ERROR")), true);
    assert.equal(
      isUnexpectedServerError(
        apiError("INTERNAL_SERVER_ERROR", "OUTPUT_INVALID", { message: "Bad output." }),
      ),
      true,
    );
    // A 503 nobody marked retryable is no planned refusal.
    assert.equal(isUnexpectedServerError(new ORPCError("SERVICE_UNAVAILABLE")), true);
  });

  test("a caller that left, Next's control flow and React's postpone are not faults", () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    assert.equal(isUnexpectedServerError(aborted), false);
    for (const digest of ["NEXT_REDIRECT;replace;/login;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
      assert.equal(isUnexpectedServerError(Object.assign(new Error(digest), { digest })), false);
    }
    assert.equal(isUnexpectedServerError({ $$typeof: Symbol.for("react.postpone") }), false);
    // A render error whose digest is only a hash is a fault.
    assert.equal(isUnexpectedServerError(Object.assign(new Error("x"), { digest: "123" })), true);
  });

  test("a route's evlog error counts by its status", () => {
    const evlog = (status: number) =>
      Object.assign(new Error("failed"), { name: "EvlogError", status });
    assert.equal(isUnexpectedServerError(evlog(404)), false);
    assert.equal(isUnexpectedServerError(evlog(500)), true);
  });
});

describe("the copy that is sent", () => {
  test("message, frames and causes go through the sanitizer", () => {
    const cause = errorAt("no row for jane@example.com", "query (/app/db.js:3:4)");
    const error = errorAt("inbox failed for jane@example.com", "listInbox (/app/inbox.js:1:2)");
    error.cause = cause;
    error.stack += "\n    at handler (/app/handoffs/jane@example.com:9:9)";
    const { error: copy } = prepareServerError(error, sanitize);
    const text = JSON.stringify([copy.message, copy.stack, (copy.cause as Error).message]);
    assert.doesNotMatch(text, /jane@example\.com/);
    assert.equal(copy.message, "inbox failed for [email]");
    assert.match(copy.stack ?? "", /^Error: inbox failed for \[email\]\n {4}at listInbox/);
    assert.equal((copy.cause as Error).message, "no row for [email]");
  });

  test("a failed query's parameters are left out", () => {
    const error = errorAt(
      'Failed query: select "id" from "customers" where "email" = $1\nparams: jane@example.com',
      "find (/app/db.js:1:1)",
    );
    const { error: copy } = prepareServerError(error, (text) => text);
    assert.equal(copy.message, 'Failed query: select "id" from "customers" where "email" = $1');
  });

  test("a thrown value that is no Error becomes one, sanitized", () => {
    const { error: copy } = prepareServerError("token for jane@example.com", sanitize);
    assert.equal(copy.name, "NonErrorThrown");
    assert.equal(copy.message, "token for [email]");
  });

  test("the copy keeps no property of the original (a request, a payload)", () => {
    const error = Object.assign(errorAt("boom", "a (/app/a.js:1:1)"), {
      request: { headers: { authorization: "Bearer secret" } },
    });
    const { error: copy } = prepareServerError(error, sanitize);
    assert.equal(Reflect.get(copy, "request"), undefined);
  });
});

describe("one fingerprint per fault", () => {
  test("ids and numbers in the message do not split a fault", () => {
    assert.equal(
      messageTemplate('Store "st_9f8e7d6c5b4a" has 3 rows at 7c9e6679-7425-40de-944b-e07fc1f90ae7'),
      "Store <value> has <n> rows at <uuid>",
    );
    const a = prepareServerError(errorAt("row 12 missing", "f (/app/a.js:1:1)"), sanitize);
    const b = prepareServerError(errorAt("row 98 missing", "f (/app/a.js:7:3)"), sanitize);
    assert.equal(a.fingerprint, b.fingerprint);
  });

  test("another type, message or place is another fault", () => {
    const base = prepareServerError(errorAt("row missing", "f (/app/a.js:1:1)"), sanitize);
    for (const other of [
      errorAt("row missing", "f (/app/a.js:1:1)", "TypeError"),
      errorAt("column missing", "f (/app/a.js:1:1)"),
      errorAt("row missing", "g (/app/b.js:1:1)"),
    ]) {
      assert.notEqual(prepareServerError(other, sanitize).fingerprint, base.fingerprint);
    }
  });
});

describe("how many are sent", () => {
  test("a fault is sent once per window, and the repeats counted with the next one", () => {
    let now = 0;
    const throttle = createErrorThrottle({ now: () => now });
    assert.deepEqual(throttle.admit("a"), { admitted: true, repeatsSuppressed: 0 });
    now += 1000;
    assert.deepEqual(throttle.admit("a"), { admitted: false, reason: "repeat" });
    assert.deepEqual(throttle.admit("a"), { admitted: false, reason: "repeat" });
    assert.equal(throttle.admit("b").admitted, true);
    now = ERROR_REPEAT_WINDOW_MS;
    assert.deepEqual(throttle.admit("a"), { admitted: true, repeatsSuppressed: 2 });
  });

  test("at most the hourly cap, all faults together, then again the next hour", () => {
    let now = 0;
    const throttle = createErrorThrottle({ now: () => now });
    for (let index = 0; index < ERROR_HOURLY_CAP; index += 1) {
      assert.equal(throttle.admit(`fault-${index}`).admitted, true);
    }
    assert.deepEqual(throttle.admit("one-more"), { admitted: false, reason: "capped" });
    now = 60 * 60 * 1000;
    assert.equal(throttle.admit("one-more").admitted, true);
  });

  test("the sample rate drops a share of the faults, uncounted", () => {
    const draws = [0.9, 0.1];
    const throttle = createErrorThrottle({ sampleRate: 0.5, random: () => draws.shift() ?? 0 });
    assert.deepEqual(throttle.admit("a"), { admitted: false, reason: "sampled" });
    assert.equal(throttle.admit("a").admitted, true);
    assert.equal(createErrorThrottle({ sampleRate: 0 }).admit("a").admitted, false);
  });

  test("past its memory, the oldest faults are forgotten", () => {
    let now = 0;
    const throttle = createErrorThrottle({ now: () => now, maxTracked: 2, hourlyCap: 100 });
    throttle.admit("a");
    throttle.admit("b");
    throttle.admit("c");
    now += 1000;
    assert.equal(throttle.admit("a").admitted, true);
    assert.equal(throttle.admit("c").admitted, false);
  });
});

describe("the reporter", () => {
  const context: ServerErrorContext = {
    source: "procedure",
    transport: "mcp",
    procedure: "inbox.list",
    storeId: "store_1",
    client: "oauth",
    directory: "openai",
  };

  test("sends a fault with its safe context, nothing else", () => {
    const { sent, send } = recorder();
    const report = createServerErrorReporter({ send, sanitize, throttle: createErrorThrottle() });
    report(new ORPCError("NOT_FOUND"), context);
    report(errorAt("boom", "f (/app/a.js:1:1)"), context);
    assert.equal(sent.length, 1);
    const { fingerprint } = prepareServerError(errorAt("boom", "f (/app/a.js:1:1)"), sanitize);
    assert.deepEqual(sent[0]?.properties, {
      $exception_fingerprint: fingerprint,
      source: "procedure",
      http_status: 500,
      repeats_suppressed: 0,
      transport: "mcp",
      procedure: "inbox.list",
      store_id: "store_1",
      client_kind: "oauth",
      client_directory: "openai",
    });
  });

  test("a failing sender or throttle never throws", () => {
    const report = createServerErrorReporter({
      send: () => {
        throw new Error("network down");
      },
      sanitize,
      throttle: createErrorThrottle(),
    });
    assert.doesNotThrow(() => report(new Error("boom"), context));
  });

  test("the cap is announced once", () => {
    let notices = 0;
    const report = createServerErrorReporter({
      send: () => {},
      sanitize,
      throttle: createErrorThrottle({ hourlyCap: 1 }),
      onCapReached: () => (notices += 1),
    });
    for (const message of ["a", "b", "c"])
      report(errorAt(message, `${message} (/x.js:1:1)`), context);
    assert.equal(notices, 1);
  });
});

describe("the oRPC interceptor", () => {
  const base = os.$context<BaseContext>();
  // Fills the scope as the platform's middlewares do.
  const known = base.use(({ context, next }) => {
    if (context.errorScope) {
      context.errorScope.client = "api_key";
      context.errorScope.storeId = "store_1";
    }
    return next();
  });

  function contextWith(reported: Array<[unknown, ServerErrorContext]>): BaseContext {
    const reportError = (error: unknown, context: ServerErrorContext) => {
      reported.push([error, context]);
    };
    return { headers: new Headers(), transport: "openapi", ports: { reportError } as ApiPorts };
  }

  test("reports the procedure's error with who called, and rethrows it unchanged", async () => {
    const reported: Array<[unknown, ServerErrorContext]> = [];
    const boom = new Error("boom");
    const procedure = known.handler(() => {
      throw boom;
    });
    await assert.rejects(
      call(procedure, undefined, {
        context: contextWith(reported),
        path: ["inbox", "list"],
        interceptors: [reportUnexpectedErrors],
      }),
      (error) => error === boom,
    );
    assert.deepEqual(reported, [
      [
        boom,
        {
          source: "procedure",
          transport: "openapi",
          procedure: "inbox.list",
          client: "api_key",
          storeId: "store_1",
        },
      ],
    ]);
  });

  test("an answer goes through untouched", async () => {
    const reported: Array<[unknown, ServerErrorContext]> = [];
    const procedure = known.handler(() => "ok");
    const output = await call(procedure, undefined, {
      context: contextWith(reported),
      path: ["x"],
      interceptors: [reportUnexpectedErrors],
    });
    assert.equal(output, "ok");
    assert.deepEqual(reported, []);
  });
});

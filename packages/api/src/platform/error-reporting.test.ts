import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { call, ORPCError, os } from "@orpc/server";

import type { BaseContext } from "../context";
import {
  createErrorThrottle,
  createServerErrorReporter,
  ERROR_HOURLY_CAP,
  errorCode,
  ERROR_REPEAT_WINDOW_MS,
  isUnexpectedServerError,
  messageTemplate,
  prepareServerError,
  reportUnexpectedErrors,
  rootFault,
  safeErrorCode,
  type ServerErrorContext,
  type ServerErrorProperties,
} from "./error-reporting";
import { apiError, platformErrors } from "./errors";
import { largeBodyBusy } from "./large-bodies";
import { toORPCError } from "../utils/orpc-error";
import type { ApiPorts } from "./ports";

// What reaches error tracking: only faults, sanitized, a few per hour.

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
    const { error: copy } = prepareServerError(error);
    const text = JSON.stringify([copy.message, copy.stack, (copy.cause as Error).message]);
    assert.doesNotMatch(text, /jane@example\.com/);
    assert.equal(copy.message, "inbox failed for [redacted]");
    assert.match(copy.stack ?? "", /^Error: inbox failed for \[redacted\]\n {4}at listInbox/);
    assert.equal((copy.cause as Error).message, "no row for [redacted]");
  });

  test("a failed query's parameters are left out", () => {
    const error = errorAt(
      'Failed query: select "id" from "customers" where "email" = $1\nparams: jane@example.com',
      "find (/app/db.js:1:1)",
    );
    const { error: copy } = prepareServerError(error);
    assert.equal(
      copy.message,
      'Failed query: select "id" from "customers" where "email" = $1\nparams: [redacted]',
    );
  });

  test("a driver's cause loses the row it echoes", () => {
    const cause = Object.assign(
      errorAt(
        "Duplicate entry 'alice@example.invalid' for key 'customers.email_store'",
        "query (/app/node_modules/mysql2/lib/conn.js:1:1)",
      ),
      { code: "ER_DUP_ENTRY" },
    );
    const error = errorAt("Failed to create customer", "create (/app/apps/web/lib/c.ts:1:1)");
    error.cause = cause;
    const prepared = prepareServerError(error);
    assert.equal(
      (prepared.error.cause as Error).message,
      "Duplicate entry '[redacted]' for key 'customers.email_store'",
    );
  });

  test("frames name paths relative to the repository", () => {
    const error = errorAt(
      "boom",
      "load (/Users/someone/Louez/packages/api/src/services/inbox.ts:4:2)",
    );
    const { error: copy } = prepareServerError(error);
    assert.match(copy.stack ?? "", /\n {4}at load \(packages\/api\/src\/services\/inbox\.ts:4:2\)/);
    assert.doesNotMatch(copy.stack ?? "", /\/Users\/someone/);
  });

  test("a validation error says which fields, never the values it quotes", () => {
    const error = Object.assign(new Error('[{"received":"jane@example.invalid"}]'), {
      name: "ZodError",
      issues: [
        { code: "invalid_type", path: ["customer", "email"], input: "jane@example.invalid" },
        { code: "too_small", path: ["items", 0, "quantity"] },
      ],
    });
    const { error: copy } = prepareServerError(error);
    assert.equal(
      copy.message,
      "2 issue(s): invalid_type at customer.email; too_small at items.0.quantity",
    );
  });

  test("a thrown value that is no Error becomes one, sanitized", () => {
    const { error: copy } = prepareServerError("no row for jane@example.com");
    assert.equal(copy.name, "NonErrorThrown");
    assert.equal(copy.message, "no row for [redacted]");
  });

  test("the copy keeps no property of the original (a request, a payload)", () => {
    const error = Object.assign(errorAt("boom", "a (/app/a.js:1:1)"), {
      request: { headers: { authorization: "Bearer secret" } },
    });
    const { error: copy } = prepareServerError(error);
    assert.equal(Reflect.get(copy, "request"), undefined);
  });
});

describe("nested and coded errors", () => {
  test("a validation error deep in the cause chain loses its message too", () => {
    const zod = Object.assign(new Error("custom message jane-canary"), {
      name: "ZodError",
      issues: [{ code: "custom", path: ["name"], message: "jane-canary" }],
    });
    const middle = new Error("service failed", { cause: zod });
    const { error: copy } = prepareServerError(new Error("wrapper", { cause: middle }));
    const deepest = (copy.cause as Error).cause as Error;
    assert.equal(deepest.message, "1 issue(s): custom at name");
    assert.doesNotMatch(
      JSON.stringify([copy.message, (copy.cause as Error).message, deepest.message]),
      /jane-canary/,
    );
  });

  test("only a short code in its own format is sent", () => {
    assert.equal(safeErrorCode("ER_DUP_ENTRY"), "ER_DUP_ENTRY");
    assert.equal(safeErrorCode(1452), "1452");
    assert.equal(safeErrorCode("23505"), "23505");
    assert.equal(safeErrorCode("card_declined"), "card_declined");
    for (const code of ["Bearer private-code-canary", "a b", "", "A".repeat(65), {}]) {
      assert.equal(safeErrorCode(code), undefined, String(code));
    }
    const coded = Object.assign(new Error("boom"), { code: "Bearer private-code-canary" });
    assert.equal(errorCode(coded), undefined);
    assert.equal(prepareServerError(coded).code, undefined);
  });
});

describe("one fingerprint per fault", () => {
  test("a fault behind errors.internalServerError is reported as itself", () => {
    const first = errorAt(
      "Cannot read properties of undefined (reading 'ranges')",
      "readHours (/app/a.js:1:1)",
      "TypeError",
    );
    const second = errorAt(
      "Connection lost: The server closed the connection.",
      "query (/app/db.js:1:1)",
    );
    const wrapped = (cause: Error) =>
      new ORPCError("INTERNAL_SERVER_ERROR", { message: "errors.internalServerError", cause });
    const a = prepareServerError(wrapped(first));
    const b = prepareServerError(wrapped(second));
    assert.notEqual(a.fingerprint, b.fingerprint);
    assert.equal(a.fingerprint, prepareServerError(first).fingerprint);
    assert.equal(a.error.name, "TypeError");
    assert.equal(rootFault(wrapped(first)), first);
    // A refusal is not unwrapped: it is its own answer.
    const refusal = new ORPCError("NOT_FOUND", { cause: first });
    assert.equal(rootFault(refusal), refusal);
  });

  test("toORPCError keeps the fault as its cause", () => {
    const fault = new Error("boom");
    assert.equal(toORPCError(fault).cause, fault);
  });

  test("ids and numbers in the message do not split a fault", () => {
    assert.equal(
      messageTemplate('Store "st_9f8e7d6c5b4a" has 3 rows at 7c9e6679-7425-40de-944b-e07fc1f90ae7'),
      "Store <value> has <n> rows at <uuid>",
    );
    const a = prepareServerError(errorAt("row 12 missing", "f (/app/a.js:1:1)"));
    const b = prepareServerError(errorAt("row 98 missing", "f (/app/a.js:7:3)"));
    assert.equal(a.fingerprint, b.fingerprint);
  });

  test("another type, message or place is another fault", () => {
    const base = prepareServerError(errorAt("row missing", "f (/app/a.js:1:1)"));
    for (const other of [
      errorAt("row missing", "f (/app/a.js:1:1)", "TypeError"),
      errorAt("column missing", "f (/app/a.js:1:1)"),
      errorAt("row missing", "g (/app/b.js:1:1)"),
    ]) {
      assert.notEqual(prepareServerError(other).fingerprint, base.fingerprint);
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
    const report = createServerErrorReporter({ send, throttle: createErrorThrottle() });
    report(new ORPCError("NOT_FOUND"), context);
    report(errorAt("boom", "f (/app/a.js:1:1)"), context);
    assert.equal(sent.length, 1);
    const { fingerprint } = prepareServerError(errorAt("boom", "f (/app/a.js:1:1)"));
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
      throttle: createErrorThrottle(),
    });
    assert.doesNotThrow(() => report(new Error("boom"), context));
  });

  test("the cap is announced once", () => {
    let notices = 0;
    const report = createServerErrorReporter({
      send: () => {},
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

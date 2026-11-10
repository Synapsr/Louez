import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { call, ORPCError, os } from "@orpc/server";

import type { BaseContext } from "../context";
import {
  createErrorThrottle,
  createServerErrorReporter,
  ERROR_HOURLY_CAP,
  ERROR_REPEAT_WINDOW_MS,
  isUnexpectedServerError,
  prepareServerError,
  reportableCode,
  reportUnexpectedErrors,
  rootFault,
  type ServerErrorContext,
  type ServerErrorProperties,
} from "./error-reporting";
import { apiError, platformErrors } from "./errors";
import { largeBodyBusy } from "./large-bodies";
import { toORPCError } from "../utils/orpc-error";
import type { ApiPorts } from "./ports";

// What reaches error tracking: only faults, as facts without text, a few per hour.

/** Files of the repository: a frame is kept only when its file exists here. */
const HERE = fileURLToPath(import.meta.url);
const SERVICE = fileURLToPath(new URL("../services/jobs.ts", import.meta.url));
const IN_REPO = (file: string) => file.slice(file.indexOf("packages/"));

/** An error thrown at `file:line:column`, below a frame of a dependency. */
function errorAt(message: string, file = HERE, line = 12, name = "Error"): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = `${name}: ${message}\n    at handler (${file}:${line}:3)\n    at run (/app/node_modules/lib/index.js:1:1)`;
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
  test("no message's text, frames as the repository's locations, causes the same way", () => {
    const cause = errorAt("no row for jane@example.com", SERVICE, 40);
    const error = errorAt("inbox failed for jane@example.com", HERE, 12);
    error.cause = cause;
    const { error: copy } = prepareServerError(error);
    assert.equal(copy.message, "[message withheld]");
    assert.equal(copy.stack, `Error: [message withheld]\n    at ${IN_REPO(HERE)}:12:3`);
    assert.equal((copy.cause as Error).message, "[message withheld]");
    assert.equal(
      (copy.cause as Error).stack,
      `Error: [message withheld]\n    at ${IN_REPO(SERVICE)}:40:3`,
    );
    assert.doesNotMatch(
      JSON.stringify([copy.stack, (copy.cause as Error).stack]),
      /jane|node_modules/,
    );
  });

  test("a frame whose file is not in the repository is left out", () => {
    const { error: copy } = prepareServerError(errorAt("boom", "/Users/someone/tmp/script.ts", 1));
    assert.equal(copy.stack, "Error: [message withheld]");
  });

  test("a validation error, at any level, is sent as its issues' codes and paths", () => {
    const zod = Object.assign(new Error("custom message jane-canary"), {
      name: "ZodError",
      issues: [
        { code: "invalid_type", path: ["customer", "email"], input: "jane@example.invalid" },
        { code: "too_small", path: ["items", 0, "quantity"] },
      ],
    });
    const middle = new Error("service failed", { cause: zod });
    const { error: copy } = prepareServerError(new Error("wrapper", { cause: middle }));
    const deepest = (copy.cause as Error).cause as Error;
    assert.equal(
      deepest.message,
      "2 issue(s): invalid_type at customer.email; too_small at items.0.quantity",
    );
    assert.doesNotMatch(JSON.stringify([copy.message, deepest.message]), /jane/);
  });

  test("a thrown value that is no Error says only what it is", () => {
    const { error: copy } = prepareServerError("no row for jane@example.com");
    assert.equal(copy.name, "NonError");
    assert.equal(copy.message, "a thrown string");
  });

  test("the copy keeps no property of the original (a request, a payload)", () => {
    const error = Object.assign(errorAt("boom"), {
      request: { headers: { authorization: "Bearer secret" } },
    });
    const { error: copy } = prepareServerError(error);
    assert.equal(Reflect.get(copy, "request"), undefined);
  });
});

describe("codes", () => {
  test("only a known code, or one of Louez's, is sent; [code] is left out", () => {
    assert.equal(reportableCode("ER_DUP_ENTRY"), "ER_DUP_ENTRY");
    assert.equal(reportableCode("card_declined"), "card_declined");
    assert.equal(reportableCode("OUTPUT_INVALID"), "OUTPUT_INVALID");
    for (const code of ["Bearer private-code-canary", "MADE_UP_CODE", "[code]", "", 42, {}]) {
      assert.equal(reportableCode(code), undefined, String(code));
    }
    const coded = Object.assign(errorAt("boom"), { code: "Bearer private-code-canary" });
    assert.equal(prepareServerError(coded).code, undefined);
    const ours = apiError("INTERNAL_SERVER_ERROR", "OUTPUT_INVALID", { message: "Bad output." });
    assert.equal(prepareServerError(ours).code, "OUTPUT_INVALID");
  });
});

describe("one fingerprint per fault", () => {
  test("a fault behind errors.internalServerError is reported as itself", () => {
    const first = Object.assign(errorAt("x", HERE, 12, "TypeError"), {});
    const second = Object.assign(errorAt("y", SERVICE, 40), { code: "ECONNRESET" });
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

  test("the message and the column do not split a fault", () => {
    const a = prepareServerError(errorAt("row 12 missing for jane@example.com", HERE, 12));
    const b = errorAt("another text entirely", HERE, 12);
    b.stack = b.stack?.replace(":12:3)", ":12:9)");
    assert.equal(a.fingerprint, prepareServerError(b).fingerprint);
  });

  test("another class, code, schema object or place is another fault", () => {
    const base = prepareServerError(errorAt("boom", HERE, 12));
    const duplicate = (key: string) =>
      Object.assign(errorAt("boom", HERE, 12), {
        code: "ER_DUP_ENTRY",
        sqlMessage: `Duplicate entry 'jane@example.com' for key '${key}'`,
      });
    const variants = [
      errorAt("boom", HERE, 12, "TypeError"),
      Object.assign(errorAt("boom", HERE, 12), { code: "ECONNREFUSED" }),
      errorAt("boom", HERE, 30),
      errorAt("boom", SERVICE, 12),
    ];
    const fingerprints = variants.map((error) => prepareServerError(error).fingerprint);
    assert.equal(new Set([base.fingerprint, ...fingerprints]).size, variants.length + 1);
    // Two keys a database error names: two faults, never the value it quotes.
    assert.equal(
      prepareServerError(duplicate("customers.customers_unique_email_per_store")).fingerprint ===
        prepareServerError(duplicate("customers.customers_store_idx")).fingerprint,
      false,
    );
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
    client: "oauth",
    directory: "openai",
  };

  test("sends a fault with its safe context, nothing else", () => {
    const { sent, send } = recorder();
    const report = createServerErrorReporter({ send, throttle: createErrorThrottle() });
    report(new ORPCError("NOT_FOUND"), context);
    report(errorAt("boom"), context);
    assert.equal(sent.length, 1);
    const { fingerprint } = prepareServerError(errorAt("boom"));
    assert.deepEqual(sent[0]?.properties, {
      $exception_fingerprint: fingerprint,
      source: "procedure",
      http_status: 500,
      repeats_suppressed: 0,
      transport: "mcp",
      procedure: "inbox.list",
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
    // Three faults: three places.
    for (const line of [10, 20, 30]) report(errorAt("boom", HERE, line), context);
    assert.equal(notices, 1);
  });
});

describe("the oRPC interceptor", () => {
  const base = os.$context<BaseContext>();
  // Fills the scope as the platform's middlewares do.
  const known = base.use(({ context, next }) => {
    if (context.errorScope) {
      context.errorScope.client = "api_key";
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

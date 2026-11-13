import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ORPCError, ValidationError } from "@orpc/server";

import { reservationErrors } from "../contracts/reservations";
import { depositAttemptErrors } from "../contracts/deposit-attempts";
import { ApiServiceError } from "../services/errors";
import { toORPCError } from "../utils/orpc-error";
import { apiError, isRefusal, platformErrors, readAfterCommit } from "./errors";

// Every kind of error a write's handler can end on today, and which side of
// the rule it falls on: a refusal is `failed` and its idempotency key may run
// it again; anything else is `unknown` and its key never runs it again
// (platform/operations.ts).

const lostConnection = Object.assign(
  new Error("Connection lost: The server closed the connection."),
  {
    code: "PROTOCOL_CONNECTION_LOST",
    fatal: true,
  },
);
const deadlock = Object.assign(new Error("Deadlock found when trying to get lock"), {
  code: "ER_LOCK_DEADLOCK",
  errno: 1213,
});

const refusals: Array<[string, unknown]> = [
  ["a platform refusal (rights)", platformErrors.permissionDenied("categories:write")],
  ["a platform refusal (rate limit)", platformErrors.rateLimited(30)],
  ["a platform refusal (session only)", platformErrors.sessionOnly()],
  [
    "a preview asked (CONFIRMATION_REQUIRED, as confirmation.ts builds it)",
    apiError("PRECONDITION_FAILED", "CONFIRMATION_REQUIRED", {
      message: "Refund 15.00 EUR. Nothing was done yet.",
      details: { confirmationToken: "tok_1" },
    }),
  ],
  ["a token that does not match (CONFIRMATION_INVALID)", platformErrors.confirmationInvalid()],
  ["RESERVATION_BUSY after its retries", reservationErrors.busy("res_1")],
  [
    "a domain error the router translated (stock short)",
    reservationErrors.insufficientCapacity([]),
  ],
  [
    "a refusal whose trace was committed (DEPOSIT_ATTEMPT_NEEDS_STRIPE)",
    depositAttemptErrors.needsStripe("res_1", {
      paymentIntentId: "pi_1",
      status: "requires_capture",
      reason: "amount_mismatch",
      unmatchedFacts: ["amount"],
    }),
  ],
  [
    "a registered code with a server status (a provider read that failed before any write)",
    apiError("INTERNAL_SERVER_ERROR", "STRIPE_UNAVAILABLE", { message: "Stripe did not answer." }),
  ],
  [
    "the MCP bridge's own argument check",
    apiError("BAD_REQUEST", "INVALID_ARGUMENT", { message: "Bad argument." }),
  ],
];

const notRefusals: Array<[string, unknown]> = [
  ["a thrown Error", new Error("boom")],
  ["a database driver error (connection lost at COMMIT)", lostConnection],
  ["a database driver error (deadlock)", deadlock],
  ["a timeout", new DOMException("The operation timed out.", "TimeoutError")],
  ["a rejection that is not an Error", "boom"],
  ["nothing", undefined],
  ["an unexpected error a router translated", toORPCError(new Error("boom"))],
  [
    "a legacy refusal a router translated: no code to classify it by",
    toORPCError(new ApiServiceError("NOT_FOUND", "errors.apiKeyNotFound")),
  ],
  ["a legacy refusal left untranslated", new ApiServiceError("BAD_REQUEST", "errors.invalidData")],
  [
    "an oRPC error with no code",
    new ORPCError("NOT_FOUND", { message: "errors.reservationNotFound" }),
  ],
  [
    "a code the registry does not hold",
    apiError("CONFLICT", "NOT_A_LOUEZ_CODE", { message: "Unknown." }),
  ],
  [
    // Never reaches a write's record: the input is validated before the
    // middleware runs (procedures.ts, `base`).
    "oRPC's input validation",
    new ORPCError("BAD_REQUEST", {
      message: "Input validation failed",
      data: { issues: [] },
      cause: new ValidationError({ message: "Input validation failed", issues: [] }),
    }),
  ],
];

describe("isRefusal", () => {
  for (const [name, error] of refusals) {
    test(`refusal: ${name}`, () => assert.equal(isRefusal(error), true));
  }
  for (const [name, error] of notRefusals) {
    test(`not a refusal: ${name}`, () => assert.equal(isRefusal(error), false));
  }
});

describe("readAfterCommit", () => {
  test("returns what the read returns", async () => {
    assert.deepEqual(await readAfterCommit(async () => ({ id: "cat_1" })), { id: "cat_1" });
  });

  test("a refusal there is no refusal of the write, which went through", async () => {
    const gone = apiError("NOT_FOUND", "CATEGORY_NOT_FOUND", { message: "Not found." });
    await assert.rejects(
      readAfterCommit(async () => {
        throw gone;
      }),
      (error: unknown) => {
        assert.equal(isRefusal(error), false);
        assert.equal((error as Error).cause, gone);
        return true;
      },
    );
  });

  test("any other error passes as it is", async () => {
    await assert.rejects(
      readAfterCommit(async () => {
        throw deadlock;
      }),
      (error: unknown) => error === deadlock,
    );
  });
});

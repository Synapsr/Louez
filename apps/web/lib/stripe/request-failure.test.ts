import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Stripe from "stripe";

import { classifyStripeFailure } from "./request-failure";

// What a failed Stripe request tells, without Stripe. A wrong class of failure deletes
// the record of money Stripe holds or moved (an unknown outcome read as a refusal).

describe("classifyStripeFailure", () => {
  test("a declined card is a refusal, with the PaymentIntent Stripe made", () => {
    // Stripe's error carries the whole PaymentIntent; only its id is read.
    const error = Object.assign(
      Stripe.errors.StripeError.generate({
        type: "card_error",
        message: "Your card was declined.",
        code: "card_declined",
        statusCode: 402,
      }),
      { payment_intent: { id: "pi_declined" } },
    );

    assert.deepEqual(classifyStripeFailure(error), {
      kind: "refused",
      paymentIntentId: "pi_declined",
      message: "Your card was declined.",
    });
  });

  test("an invalid request is a refusal that made nothing", () => {
    const error = Stripe.errors.StripeError.generate({
      type: "invalid_request_error",
      message: "No such PaymentMethod: 'pm_gone'",
      statusCode: 400,
    });

    assert.deepEqual(classifyStripeFailure(error), {
      kind: "refused",
      paymentIntentId: null,
      message: "No such PaymentMethod: 'pm_gone'",
    });
  });

  test("a key sent with other parameters is its own answer", () => {
    const error = Stripe.errors.StripeError.generate({
      type: "idempotency_error",
      message: "Keys for idempotent requests can only be used with the same parameters.",
      statusCode: 400,
    });

    assert.deepEqual(classifyStripeFailure(error), { kind: "key_reused" });
  });

  test("a 409, a request with the same key still running, tells nothing", () => {
    const error = Stripe.errors.StripeError.generate({
      type: "invalid_request_error",
      message: "There is currently another in-progress request using this idempotency key.",
      statusCode: 409,
    });

    assert.equal(classifyStripeFailure(error).kind, "indeterminate");
  });

  test("a Stripe 500 tells nothing, and says whether it is the answer stored for the key", () => {
    const fresh = Stripe.errors.StripeError.generate({
      type: "api_error",
      message: "An unknown error occurred",
      statusCode: 500,
      headers: {},
    });
    const stored = Stripe.errors.StripeError.generate({
      type: "api_error",
      message: "An unknown error occurred",
      statusCode: 500,
      headers: { "Idempotent-Replayed": "true" },
    });

    assert.deepEqual(classifyStripeFailure(fresh), {
      kind: "indeterminate",
      replayed: false,
      message: "An unknown error occurred",
    });
    assert.deepEqual(classifyStripeFailure(stored), {
      kind: "indeterminate",
      replayed: true,
      message: "An unknown error occurred",
    });
  });

  test("a timeout, a network error, a rate limit and an account Louez cannot reach tell nothing", () => {
    const failures = [
      new Stripe.errors.StripeConnectionError({
        type: "api_error",
        message: "Request aborted due to timeout",
      }),
      Stripe.errors.StripeError.generate({
        type: "rate_limit_error",
        message: "Too many requests",
        statusCode: 429,
      }),
      new Stripe.errors.StripePermissionError({
        type: "invalid_request_error",
        message: "The provided key does not have access to account",
        statusCode: 403,
      }),
      new Error("socket hang up"),
      "ECONNRESET",
    ];

    for (const failure of failures) {
      const classified = classifyStripeFailure(failure);
      assert.equal(classified.kind, "indeterminate");
      assert.equal(classified.kind === "indeterminate" && classified.replayed, false);
    }
  });
});

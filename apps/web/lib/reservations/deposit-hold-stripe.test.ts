import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Stripe from "stripe";

import {
  ATTEMPT_LOOKUP_MAX_PAGES,
  classifyStripeFailure,
  type StripeDepositIntent,
  depositIntentFromStripe,
  findAttemptIntent,
} from "./deposit-hold-stripe";
import { fakeDepositStripe } from "./fake-deposit-stripe.fixtures";

// The Stripe side of a deposit hold, without Stripe: what a failed request tells, how
// a PaymentIntent is read, and the search for an attempt's PaymentIntent. A wrong class
// of failure deletes the record of money Stripe holds (an unknown outcome read as a
// refusal); a deadline made up makes Louez say a live hold lapsed.

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

const DAY = 24 * 3600;

/** A PaymentIntent as Stripe's API answers it, with the fields a deposit hold reads. */
const stripePaymentIntent = (values: Partial<StripeDepositIntent> = {}): StripeDepositIntent => ({
  id: "pi_hold",
  status: "requires_capture",
  amount: 30_000,
  amount_received: 0,
  currency: "eur",
  capture_method: "manual",
  customer: "cus_1",
  payment_method: "pm_card",
  latest_charge: null,
  metadata: { reservationId: "res_1", depositHoldAttemptId: "attempt_1", type: "deposit_hold" },
  ...values,
});

const cardCharge = (captureBefore: number | undefined) => ({
  id: "ch_hold",
  payment_method_details: { card: { capture_before: captureBefore } },
});

describe("depositIntentFromStripe", () => {
  test("the deadline of the authorization is the one Stripe states on the card charge", () => {
    const created = 1_800_000_000;
    // Seven days is Stripe's usual window; some networks give far longer.
    for (const days of [5, 7, 30]) {
      const intent = depositIntentFromStripe(
        stripePaymentIntent({ latest_charge: cardCharge(created + days * DAY) }),
      );
      assert.equal(intent.captureBefore?.getTime(), (created + days * DAY) * 1000);
    }
  });

  test("where Stripe states no deadline, none is made up", () => {
    const withoutDeadline = [
      // The charge was not expanded: only its id came back.
      "ch_hold",
      null,
      // A charge that carries no deadline: captured, or not a card's.
      cardCharge(undefined),
      { id: "ch_hold", payment_method_details: { card: null } },
      { id: "ch_hold", payment_method_details: null },
      { id: "ch_hold" },
    ];
    for (const latest_charge of withoutDeadline) {
      const intent = depositIntentFromStripe(stripePaymentIntent({ latest_charge }));
      assert.equal(intent.captureBefore, null, JSON.stringify(latest_charge));
    }
  });

  test("every other fact is read from the PaymentIntent, expanded or not", () => {
    assert.deepEqual(
      depositIntentFromStripe(
        stripePaymentIntent({
          status: "succeeded",
          amount_received: 12_000,
          customer: { id: "cus_1" },
          payment_method: { id: "pm_card" },
          latest_charge: cardCharge(undefined),
        }),
      ),
      {
        paymentIntentId: "pi_hold",
        status: "succeeded",
        amountMinor: 30_000,
        capturedMinor: 12_000,
        currency: "EUR",
        captureBefore: null,
        captureMethod: "manual",
        customerId: "cus_1",
        paymentMethodId: "pm_card",
        chargeId: "ch_hold",
        attemptId: "attempt_1",
        reservationId: "res_1",
      },
    );
    // The customer's own authorization names no attempt, and has no customer.
    const own = depositIntentFromStripe(
      stripePaymentIntent({ customer: null, metadata: { reservationId: "res_1" } }),
    );
    assert.equal(own.attemptId, null);
    assert.equal(own.customerId, null);
  });
});

describe("findAttemptIntent", () => {
  const ACCOUNT = "acct_lookup";
  const attempt = { id: "attempt_1", accountId: ACCOUNT, paymentMethodId: "pm_card" };

  const stripeWith = (pageSize: number, older: number, options: { attempt?: boolean } = {}) => {
    const stripe = fakeDepositStripe({ pageSize });
    stripe.saveCard(ACCOUNT, "pm_card", "cus_1");
    const make = (attemptId: string | null) =>
      stripe.createIntent({
        accountId: ACCOUNT,
        customerId: "cus_1",
        paymentMethodId: "pm_card",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_capture",
        attemptId,
        reservationId: "res_1",
      });
    // Newest first: the attempt's PaymentIntent is listed after `older` others.
    if (options.attempt !== false) make("attempt_1");
    for (let index = 0; index < older; index++) make(null);
    return stripe;
  };

  test("the attempt's PaymentIntent is found on a later page", async () => {
    const stripe = stripeWith(2, 4);

    const found = await findAttemptIntent(stripe.port, attempt);

    assert.equal(found.kind, "found");
    assert.equal(found.kind === "found" && found.intent.attemptId, "attempt_1");
    assert.equal(stripe.pagesRead.length, 3);
  });

  test("a listing read to its end with none is absence", async () => {
    const stripe = stripeWith(2, 3, { attempt: false });

    assert.deepEqual(await findAttemptIntent(stripe.port, attempt), { kind: "absent" });
    assert.equal(stripe.pagesRead.length, 2);
    // A customer with no PaymentIntent at all.
    assert.deepEqual(await findAttemptIntent(stripeWith(2, 0, { attempt: false }).port, attempt), {
      kind: "absent",
    });
  });

  test("a listing stopped at its bound says nothing, whatever lies beyond", async () => {
    // One page more than the bound reads: the attempt's PaymentIntent is on it.
    const stripe = stripeWith(1, ATTEMPT_LOOKUP_MAX_PAGES);

    assert.deepEqual(await findAttemptIntent(stripe.port, attempt), { kind: "unknown" });
    assert.equal(stripe.pagesRead.length, ATTEMPT_LOOKUP_MAX_PAGES);
    // Exactly the bound, read to its end: that is a complete listing.
    const complete = stripeWith(1, ATTEMPT_LOOKUP_MAX_PAGES, { attempt: false });
    assert.deepEqual(await findAttemptIntent(complete.port, attempt), { kind: "absent" });
  });

  test("a card detached from its customer names nobody to search: nothing is concluded", async () => {
    const stripe = stripeWith(2, 1);
    stripe.saveCard(ACCOUNT, "pm_card", "");

    assert.deepEqual(await findAttemptIntent(stripe.port, attempt), { kind: "unknown" });
    assert.deepEqual(stripe.pagesRead, []);
  });

  test("only the attempt's account is read", async () => {
    const stripe = stripeWith(2, 1, { attempt: false });
    stripe.createIntent({
      accountId: "acct_other",
      customerId: "cus_1",
      paymentMethodId: "pm_card",
      amountMinor: 5000,
      currency: "EUR",
      status: "requires_capture",
      attemptId: "attempt_1",
      reservationId: "res_1",
    });

    assert.deepEqual(await findAttemptIntent(stripe.port, attempt), { kind: "absent" });
    assert.deepEqual(stripe.pagesRead, [{ accountId: ACCOUNT, customerId: "cus_1" }]);
  });
});

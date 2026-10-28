import assert from "node:assert/strict";
import { describe, test } from "node:test";

import Stripe from "stripe";

import {
  type StripeAnswer,
  type StripeCharge,
  type StripeChargeReads,
  type StripeReferences,
  chargeIdFor,
  findStripeCharge,
  grossFromCharge,
  isStripeAccountRefusal,
  isStripeNotFound,
  stripeChargeReads,
} from "./gross-backfill-core";

// The rule that turns a Stripe charge into a payment's gross amount (louez-billing
// docs/api README Q7, fees.md §3 and §8), and how the backfill finds that charge. Stripe
// is a stub: no network.

const charge = (overrides: Partial<StripeCharge> = {}): StripeCharge => ({
  object: "charge",
  id: "ch_1",
  amount: 10_000,
  amount_captured: 10_000,
  amount_refunded: 0,
  currency: "eur",
  status: "succeeded",
  captured: true,
  ...overrides,
});

const notFound = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    statusCode: 404,
    message: "No such charge",
  });

describe("grossFromCharge", () => {
  test("a rental's gross is the charge amount, whatever refunds netted from its amount", () => {
    assert.deepEqual(
      grossFromCharge({ type: "rental", amount: "60.00", currency: "EUR", charge: charge() }),
      { grossMinor: 10_000 },
    );
    assert.deepEqual(
      grossFromCharge({ type: "rental", amount: "0.00", currency: "EUR", charge: charge() }),
      { grossMinor: 10_000 },
    );
  });

  test("a deposit hold takes the amount authorised, a capture the amount captured", () => {
    const held = charge({ amount: 50_000, amount_captured: 0, captured: false });
    assert.deepEqual(
      grossFromCharge({ type: "deposit_hold", amount: "500.00", currency: "EUR", charge: held }),
      { grossMinor: 50_000 },
    );
    const captured = charge({ amount: 50_000, amount_captured: 12_000 });
    assert.deepEqual(
      grossFromCharge({
        type: "deposit_capture",
        amount: "120.00",
        currency: "EUR",
        charge: captured,
      }),
      { grossMinor: 12_000 },
    );
  });

  test("a zero-decimal currency counts whole units", () => {
    assert.deepEqual(
      grossFromCharge({
        type: "rental",
        amount: "5000.00",
        currency: "JPY",
        charge: charge({ amount: 5000, amount_captured: 5000, currency: "jpy" }),
      }),
      { grossMinor: 5000 },
    );
  });

  test("a charge that does not match the payment leaves it empty", () => {
    const cases: Array<[Parameters<typeof grossFromCharge>[0], string]> = [
      [
        { type: "rental", amount: "100.00", currency: "USD", charge: charge() },
        "currency_mismatch",
      ],
      [
        { type: "rental", amount: "100.00", currency: "EUR", charge: charge({ status: "failed" }) },
        "charge_not_succeeded",
      ],
      [
        {
          type: "rental",
          amount: "100.00",
          currency: "EUR",
          charge: charge({ captured: false, amount_captured: 0 }),
        },
        "charge_not_captured",
      ],
      [
        {
          type: "deposit_capture",
          amount: "100.00",
          currency: "EUR",
          charge: charge({ captured: false, amount_captured: 0 }),
        },
        "charge_not_captured",
      ],
      [
        {
          type: "rental",
          amount: "80.00",
          currency: "EUR",
          charge: charge({ amount_captured: 8000 }),
        },
        "charge_partly_captured",
      ],
      [
        { type: "rental", amount: "100.01", currency: "EUR", charge: charge() },
        "charge_below_amount",
      ],
      [
        {
          type: "rental",
          amount: "10.000",
          currency: "KWD",
          charge: charge({ currency: "kwd" }),
        },
        "unsupported_currency",
      ],
    ];
    for (const [input, reason] of cases) {
      assert.deepEqual(grossFromCharge(input), { reason }, reason);
    }
  });

  test("a deposit hold takes no charge id: its capture holds the charge", () => {
    assert.equal(chargeIdFor("deposit_hold", charge()), null);
    assert.equal(chargeIdFor("deposit_capture", charge()), "ch_1");
    assert.equal(chargeIdFor("rental", charge()), "ch_1");
  });
});

/** Stripe reads in memory, by account and id, with the calls they got. */
function fakeReads(objects: Record<string, unknown>, refusing: readonly string[] = []) {
  const calls: string[] = [];
  const read =
    (kind: string) =>
    async (accountId: string, id: string): Promise<StripeAnswer> => {
      calls.push(`${kind} ${accountId} ${id}`);
      if (refusing.includes(accountId)) return { missing: "account_inaccessible" };
      const object = objects[`${accountId} ${id}`];
      return object === undefined ? { missing: "not_found_on_stripe" } : { found: object };
    };
  const reads: StripeChargeReads = {
    charge: read("charge"),
    paymentIntent: read("paymentIntent"),
    checkoutSession: read("checkoutSession"),
  };
  return { reads, calls };
}

const NO_REFERENCES: StripeReferences = {
  stripeChargeId: null,
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
};

describe("findStripeCharge", () => {
  const expanded = charge({ id: "ch_pi" });

  test("by charge id, else the PaymentIntent's latest charge, else the session's", async () => {
    const { reads, calls } = fakeReads({
      "acct_1 ch_1": charge(),
      "acct_1 pi_1": { object: "payment_intent", latest_charge: expanded },
      "acct_1 pi_2": { object: "payment_intent", latest_charge: "ch_1" },
      "acct_1 cs_1": {
        object: "checkout.session",
        payment_intent: { object: "payment_intent", latest_charge: expanded },
      },
      "acct_1 cs_2": { object: "checkout.session", payment_intent: "pi_1" },
    });
    const find = (references: Partial<StripeReferences>) =>
      findStripeCharge(reads, "acct_1", { ...NO_REFERENCES, ...references });

    assert.deepEqual(await find({ stripeChargeId: "ch_1", stripePaymentIntentId: "pi_1" }), {
      charge: charge(),
    });
    assert.deepEqual(
      await find({ stripePaymentIntentId: "pi_1", stripeCheckoutSessionId: "cs_1" }),
      {
        charge: expanded,
      },
    );
    assert.deepEqual(await find({ stripePaymentIntentId: "pi_2" }), { charge: charge() });
    assert.deepEqual(await find({ stripeCheckoutSessionId: "cs_1" }), { charge: expanded });
    assert.deepEqual(await find({ stripeCheckoutSessionId: "cs_2" }), { charge: expanded });
    assert.deepEqual(calls, [
      "charge acct_1 ch_1",
      "paymentIntent acct_1 pi_1",
      "paymentIntent acct_1 pi_2",
      "charge acct_1 ch_1",
      "checkoutSession acct_1 cs_1",
      "checkoutSession acct_1 cs_2",
      "paymentIntent acct_1 pi_1",
    ]);
  });

  test("what Stripe does not have, an account it refuses, and a PaymentIntent without a charge, are reasons", async () => {
    const { reads } = fakeReads(
      {
        "acct_1 pi_none": { object: "payment_intent", latest_charge: null },
        "acct_1 cs_none": { object: "checkout.session", payment_intent: null },
        "acct_gone pi_1": { object: "payment_intent", latest_charge: charge() },
      },
      ["acct_gone"],
    );
    const find = (references: Partial<StripeReferences>) =>
      findStripeCharge(reads, "acct_1", { ...NO_REFERENCES, ...references });

    assert.deepEqual(await find({}), { reason: "no_stripe_reference" });
    assert.deepEqual(await find({ stripeChargeId: "ch_other" }), {
      reason: "not_found_on_stripe",
    });
    assert.deepEqual(await find({ stripePaymentIntentId: "pi_none" }), { reason: "no_charge" });
    assert.deepEqual(await find({ stripeCheckoutSessionId: "cs_none" }), { reason: "no_charge" });
    assert.deepEqual(
      await findStripeCharge(reads, "acct_gone", {
        ...NO_REFERENCES,
        stripePaymentIntentId: "pi_1",
      }),
      { reason: "account_inaccessible" },
    );
  });

  test("an answer that is not the object asked for throws", async () => {
    const { reads } = fakeReads({ "acct_1 ch_1": { object: "refund", id: "re_1" } });
    await assert.rejects(
      findStripeCharge(reads, "acct_1", { ...NO_REFERENCES, stripeChargeId: "ch_1" }),
      /Stripe answered an unexpected charge/,
    );
  });
});

describe("stripeChargeReads", () => {
  test("it reads on the connected account, with the charge expanded, and names a 404", async () => {
    const stripe = new Stripe("sk_test_stub");
    const calls: unknown[][] = [];
    Reflect.set(stripe.charges, "retrieve", async (...args: unknown[]) => {
      calls.push(["charges", ...args]);
      throw notFound();
    });
    Reflect.set(stripe.paymentIntents, "retrieve", async (...args: unknown[]) => {
      calls.push(["paymentIntents", ...args]);
      return { object: "payment_intent", latest_charge: null };
    });
    Reflect.set(stripe.checkout.sessions, "retrieve", async (...args: unknown[]) => {
      calls.push(["sessions", ...args]);
      throw new Stripe.errors.StripeAPIError({ type: "api_error", statusCode: 500 });
    });
    const reads = stripeChargeReads(stripe);

    assert.deepEqual(await reads.charge("acct_1", "ch_1"), { missing: "not_found_on_stripe" });
    assert.deepEqual(await reads.paymentIntent("acct_1", "pi_1"), {
      found: { object: "payment_intent", latest_charge: null },
    });
    await assert.rejects(reads.checkoutSession("acct_1", "cs_1"), Stripe.errors.StripeAPIError);
    assert.deepEqual(calls, [
      ["charges", "ch_1", {}, { stripeAccount: "acct_1" }],
      ["paymentIntents", "pi_1", { expand: ["latest_charge"] }, { stripeAccount: "acct_1" }],
      [
        "sessions",
        "cs_1",
        { expand: ["payment_intent.latest_charge"] },
        { stripeAccount: "acct_1" },
      ],
    ]);
  });

  test("an account that refuses the platform is named, not thrown", async () => {
    const stripe = new Stripe("sk_test_stub");
    const refusals = [
      // What Stripe answers for a Standard account that revoked the platform.
      new Stripe.errors.StripePermissionError({
        type: "invalid_request_error",
        statusCode: 403,
        message:
          "The provided key 'sk_live_****' does not have access to account 'acct_1' (or that account does not exist). Application access may have been revoked.",
      }),
      new Stripe.errors.StripeAuthenticationError({
        type: "authentication_error",
        statusCode: 401,
      }),
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        statusCode: 400,
        code: "account_invalid",
      }),
    ];
    const reads = stripeChargeReads(stripe);
    for (const refusal of refusals) {
      Reflect.set(stripe.charges, "retrieve", async () => {
        throw refusal;
      });
      assert.deepEqual(await reads.charge("acct_1", "ch_1"), { missing: "account_inaccessible" });
    }
  });

  test("only Stripe's not-found counts as not found", () => {
    assert.equal(isStripeNotFound(notFound()), true);
    assert.equal(
      isStripeNotFound(
        new Stripe.errors.StripePermissionError({ type: "invalid_request_error", statusCode: 403 }),
      ),
      false,
    );
    assert.equal(isStripeNotFound(new Error("No such charge")), false);
  });

  test("a refusal is a 401, a 403 or account_invalid, from Stripe", () => {
    assert.equal(
      isStripeAccountRefusal(
        new Stripe.errors.StripePermissionError({ type: "invalid_request_error", statusCode: 403 }),
      ),
      true,
    );
    assert.equal(isStripeAccountRefusal(notFound()), false);
    assert.equal(
      isStripeAccountRefusal(
        new Stripe.errors.StripeAPIError({ type: "api_error", statusCode: 500 }),
      ),
      false,
    );
    assert.equal(isStripeAccountRefusal(new Error("does not have access to account")), false);
  });
});

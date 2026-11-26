import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ORPCError } from "@orpc/client";

import { STRIPE_REFUND_REFUSAL_CODES } from "@louez/api/contracts/stripe-refunds";

import {
  type ReservationPayment,
  type StripeRefundContext,
  type StripeRefundOperation,
  opensInStripe,
  pendingStripeRefunds,
  stripeRefundAttemptOf,
  stripeRefundAvailability,
  stripeRefundFailureKey,
  stripeRefundFailureOf,
  stripeRefundKeyFor,
  stripeRefundOutcomeOf,
  stripeRefundRefusalOf,
  stripeRefundRemaining,
  stripeRefundSendFailure,
} from "./util.stripe-refund";

// Which Stripe rows of the payment history offer "Refund", and whether it can be sent;
// how each refusal of the refund, its preview and the Stripe link reads; and what a failed
// send says of its refund.

/**
 * A payment row exactly as `reservations.get` gives it, here a completed online payment
 * of a Checkout Session: what the page has, and nothing it does not (no Stripe charge).
 */
const paid = (patch: Partial<ReservationPayment> = {}): ReservationPayment => ({
  id: "pay_1",
  amount: "120.00",
  currency: "EUR",
  type: "rental",
  method: "stripe",
  status: "completed",
  notes: null,
  paidAt: new Date("2031-05-20T10:00:00Z"),
  createdAt: new Date("2031-05-20T09:58:00Z"),
  refundOfPaymentId: null,
  capturedAmount: null,
  authorizationExpiresAt: null,
  releaseOwedAt: null,
  stripeRefundId: null,
  stripePaymentIntentId: "pi_1",
  stripeCheckoutSessionId: "cs_1",
  sessionSettledAt: null,
  ...patch,
});
const operation = (patch: Partial<StripeRefundOperation> = {}): StripeRefundOperation => ({
  id: "op_1",
  paymentId: "pay_1",
  refundPaymentId: null,
  status: "pending",
  amount: "20.00",
  createdAt: "2031-06-01T10:00:00Z",
  failure: null,
  ...patch,
});
const context = (patch: Partial<StripeRefundContext> = {}): StripeRefundContext => ({
  payments: [],
  refunds: [],
  disputes: [],
  canRefund: true,
  ...patch,
});
const availability = (payment: ReservationPayment, patch: Partial<StripeRefundContext> = {}) =>
  stripeRefundAvailability(payment, context({ payments: [payment], ...patch }));

describe("stripeRefundAvailability", () => {
  test("a completed online payment with money left offers Refund", () => {
    for (const type of ["rental", "damage", "adjustment", "deposit_capture"] as const) {
      assert.deepEqual(availability(paid({ type })), { state: "available" }, type);
    }
  });

  test("as the page has it from reservations.get, a completed online payment can be refunded", () => {
    // The row of a real test payment: completed, its PaymentIntent and Checkout Session,
    // no Stripe charge (the page is not given one).
    const fromTheRead: ReservationPayment = {
      id: "pay_real",
      amount: "45.00",
      currency: "EUR",
      type: "rental",
      method: "stripe",
      status: "completed",
      notes: null,
      paidAt: new Date("2031-06-01T09:00:00Z"),
      createdAt: new Date("2031-06-01T08:59:00Z"),
      refundOfPaymentId: null,
      capturedAmount: null,
      authorizationExpiresAt: null,
      releaseOwedAt: null,
      stripeRefundId: null,
      stripePaymentIntentId: "pi_real",
      stripeCheckoutSessionId: "cs_real",
      sessionSettledAt: null,
    };
    assert.deepEqual(availability(fromTheRead), { state: "available" });
    assert.equal(opensInStripe(fromTheRead), true);
  });

  test("hidden on what is not money taken online that can still give some back", () => {
    const hidden = { state: "hidden" };
    // Taken by hand: its own refund button, unchanged.
    assert.deepEqual(availability(paid({ method: "cash" })), hidden);
    // A refund row, of either kind, and a deposit return.
    assert.deepEqual(availability(paid({ refundOfPaymentId: "pay_0" })), hidden);
    assert.deepEqual(
      availability(
        paid({
          stripeRefundId: "re_1",
          stripePaymentIntentId: null,
          stripeCheckoutSessionId: null,
        }),
      ),
      hidden,
    );
    assert.deepEqual(availability(paid({ type: "deposit_return" })), hidden);
    // A deposit, and a hold not captured: its capture is the payment to refund.
    assert.deepEqual(availability(paid({ type: "deposit" })), hidden);
    assert.deepEqual(availability(paid({ type: "deposit_hold", status: "authorized" })), hidden);
    // Failed or cancelled.
    assert.deepEqual(availability(paid({ status: "failed" })), hidden);
    assert.deepEqual(availability(paid({ status: "cancelled" })), hidden);
    // Refunded in full.
    assert.deepEqual(availability(paid({ status: "refunded" })), hidden);
    assert.deepEqual(availability(paid({ amount: "0.00" })), hidden);
    // A checkout never paid, or one Stripe said can no longer be paid.
    assert.deepEqual(
      availability(paid({ status: "pending", stripePaymentIntentId: null })),
      hidden,
    );
    assert.deepEqual(
      availability(paid({ status: "pending", sessionSettledAt: new Date("2031-06-01T10:30:00Z") })),
      hidden,
    );
  });

  test("hidden once refunds in progress and refunds given by hand hold what is left", () => {
    const payment = paid({ amount: "50.00" });
    const inFlight = operation({ amount: "30.00" });
    assert.deepEqual(availability(payment, { refunds: [inFlight] }), { state: "available" });
    assert.deepEqual(
      availability(payment, { refunds: [inFlight, operation({ id: "op_2", amount: "20.00" })] }),
      { state: "hidden" },
    );
    const byHand = paid({
      id: "pay_refund",
      method: "cash",
      amount: "20.00",
      refundOfPaymentId: "pay_1",
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: null,
    });
    assert.deepEqual(
      stripeRefundAvailability(
        payment,
        context({ payments: [payment, byHand], refunds: [inFlight] }),
      ),
      { state: "hidden" },
    );
  });

  test("a refund Stripe already made comes off the row, so it no longer holds anything back", () => {
    const payment = paid({ amount: "100.00" });
    // Its row is written and the payment netted: only refunds with no row of their own count.
    const processing = operation({ refundPaymentId: "pay_refund", amount: "20.00" });
    assert.equal(stripeRefundRemaining(payment, context({ refunds: [processing] })), 10_000);
    assert.equal(stripeRefundRemaining(payment, context({ refunds: [operation()] })), 8_000);
  });

  test("shown but blocked, with why: a dispute, not settled yet, a role that may not refund", () => {
    const payment = paid();
    assert.deepEqual(
      availability(payment, { disputes: [{ paymentId: "pay_1", status: "open" }] }),
      { state: "disabled", reason: "disputed" },
    );
    // A dispute that ended blocks nothing.
    assert.deepEqual(availability(payment, { disputes: [{ paymentId: "pay_1", status: "won" }] }), {
      state: "available",
    });
    // Still pending at Stripe, its PaymentIntent created: not settled yet.
    assert.deepEqual(availability(paid({ status: "pending" })), {
      state: "disabled",
      reason: "not_settled",
    });
    assert.deepEqual(availability(payment, { canRefund: false }), {
      state: "disabled",
      reason: "no_permission",
    });
  });
});

test("a row opens in Stripe when Stripe holds a payment for it", () => {
  assert.equal(opensInStripe(paid()), true);
  assert.equal(opensInStripe(paid({ stripePaymentIntentId: null })), false);
  assert.equal(opensInStripe(paid({ method: "card" })), false);
});

test("the refunds read again are the pending ones", () => {
  const refunds = [
    operation(),
    operation({ id: "op_2", status: "succeeded" }),
    operation({ id: "op_3", status: "failed" }),
  ];
  assert.deepEqual(
    pendingStripeRefunds(refunds).map((refund) => refund.id),
    ["op_1"],
  );
});

describe("a failed refund's reason", () => {
  test("Stripe's and Louez's codes read as the store's reasons; any other is generic", () => {
    assert.equal(stripeRefundFailureKey("charge_disputed"), "disputed");
    assert.equal(stripeRefundFailureKey("insufficient_funds"), "balance");
    assert.equal(stripeRefundFailureKey("balance_insufficient"), "balance");
    assert.equal(stripeRefundFailureKey("expired_or_canceled_card"), "card");
    assert.equal(stripeRefundFailureKey("charge_already_refunded"), "alreadyRefunded");
    assert.equal(stripeRefundFailureKey("not_found_at_stripe"), "notMade");
    assert.equal(stripeRefundFailureKey("canceled"), "canceled");
    assert.equal(stripeRefundFailureKey("something_new"), "generic");
  });

  test("on its own row once Stripe made it; on the payment when Stripe made none", () => {
    const failed = operation({ status: "failed", failure: { code: "declined", message: null } });
    const refundRow = paid({ id: "pay_refund", refundOfPaymentId: "pay_1" });
    assert.equal(
      stripeRefundFailureOf(refundRow, [{ ...failed, refundPaymentId: "pay_refund" }]),
      "card",
    );
    assert.equal(
      stripeRefundFailureOf(paid(), [{ ...failed, refundPaymentId: "pay_refund" }]),
      null,
    );
    assert.equal(stripeRefundFailureOf(paid(), [failed]), "card");
    // A later refund of the same payment stands over an earlier failure.
    assert.equal(
      stripeRefundFailureOf(paid(), [
        failed,
        operation({ id: "op_2", status: "succeeded", createdAt: "2031-06-01T11:00:00Z" }),
      ]),
      null,
    );
  });
});

describe("stripeRefundRefusalOf", () => {
  const refusal = (code: string, details?: Record<string, unknown>) =>
    stripeRefundRefusalOf(
      new ORPCError("CONFLICT", { message: "English for agents", data: { code, details } }),
    );

  test("each refusal the refund answers before anything is asked has its own words", () => {
    for (const code of STRIPE_REFUND_REFUSAL_CODES) {
      const details =
        code === "REFUND_EXCEEDS_REFUNDABLE"
          ? { refundable: "75.00", currency: "EUR" }
          : code === "REFUND_CURRENCY_NOT_SUPPORTED"
            ? { currency: "KWD" }
            : code === "REFUND_REPEAT_UNCONFIRMED"
              ? {
                  refundedAt: "2031-06-01T10:00:00.000Z",
                  by: "Ada",
                  amount: "20.00",
                  currency: "EUR",
                }
              : undefined;
      assert.notEqual(refusal(code, details).key, "generic", code);
    }
  });

  test("with the facts they carry", () => {
    assert.deepEqual(
      refusal("REFUND_EXCEEDS_REFUNDABLE", { refundable: "75.00", currency: "EUR" }),
      {
        key: "exceedsRefundable",
        refundable: "75.00",
        currency: "EUR",
      },
    );
    assert.deepEqual(refusal("REFUND_CURRENCY_NOT_SUPPORTED", { currency: "KWD" }), {
      key: "currencyNotSupported",
      currency: "KWD",
    });
    assert.deepEqual(
      refusal("REFUND_REPEAT_UNCONFIRMED", {
        refundedAt: "2031-06-01T10:00:00.000Z",
        by: null,
        amount: "20.00",
        currency: "EUR",
      }),
      {
        key: "repeatUnconfirmed",
        refundedAt: "2031-06-01T10:00:00.000Z",
        by: null,
        amount: "20.00",
        currency: "EUR",
      },
    );
    assert.deepEqual(refusal("REFUND_ALREADY_IN_PROGRESS"), { key: "alreadyInProgress" });
    assert.deepEqual(refusal("PAYMENT_DISPUTED"), { key: "disputed" });
    assert.deepEqual(refusal("PAYMENT_NOT_SETTLED"), { key: "notSettled" });
    assert.deepEqual(refusal("PAYMENT_NOT_REFUNDABLE"), { key: "notRefundable" });
    assert.deepEqual(refusal("PAYMENT_CHARGE_SHARED"), { key: "chargeShared" });
    assert.deepEqual(refusal("NO_STRIPE_ACCOUNT"), { key: "noStripeAccount" });
    assert.deepEqual(refusal("REFUND_AMOUNT_INVALID"), { key: "amountInvalid" });
    assert.deepEqual(refusal("REFUND_PAYMENT_TAKEN_BY_HAND"), { key: "takenByHand" });
    assert.deepEqual(refusal("PAYMENT_NOT_FOUND"), { key: "notFound" });
    assert.deepEqual(refusal("STRIPE_UNAVAILABLE"), { key: "stripeUnavailable" });
    assert.deepEqual(refusal("PERMISSION_DENIED"), { key: "permission" });
    assert.deepEqual(refusal("NO_STORE_ACCESS"), { key: "permission" });
    assert.deepEqual(refusal("DEMO_STORE_REFUSED"), { key: "demo" });
    assert.deepEqual(refusal("PAYMENT_NOT_IN_STRIPE"), { key: "notInStripe" });
    assert.deepEqual(refusal("STRIPE_NOT_CONFIGURED"), { key: "stripeNotConfigured" });
    assert.deepEqual(refusal("OPERATION_IN_PROGRESS"), { key: "inProgress" });
    assert.deepEqual(refusal("OPERATION_OUTCOME_UNKNOWN"), { key: "outcomeUnknown" });
  });

  test("anything else reads as the generic message, never its technical detail", () => {
    assert.deepEqual(refusal("IDEMPOTENCY_KEY_REUSED"), { key: "generic" });
    assert.deepEqual(refusal("REFUND_EXCEEDS_REFUNDABLE"), { key: "generic" });
    assert.deepEqual(stripeRefundRefusalOf(new Error("socket hang up")), { key: "generic" });
    assert.deepEqual(stripeRefundRefusalOf(new ORPCError("INTERNAL_SERVER_ERROR")), {
      key: "generic",
    });
  });
});

describe("what a failed send says of its refund", () => {
  const failed = (code?: string) =>
    new ORPCError("CONFLICT", { data: code ? { code } : undefined });

  test("a refusal Louez words is known: nothing was refunded", () => {
    assert.deepEqual(stripeRefundSendFailure(failed("PAYMENT_DISPUTED")), {
      known: true,
      refusal: { key: "disputed" },
    });
    assert.equal(stripeRefundSendFailure(failed("STRIPE_UNAVAILABLE")).known, true);
    assert.equal(stripeRefundSendFailure(failed("REFUND_ALREADY_IN_PROGRESS")).known, true);
  });

  test("a call still running, an outcome not recorded, no answer: not known", () => {
    assert.deepEqual(stripeRefundSendFailure(failed("OPERATION_IN_PROGRESS")), {
      known: false,
      refusal: { key: "inProgress" },
    });
    assert.deepEqual(stripeRefundSendFailure(failed("OPERATION_OUTCOME_UNKNOWN")), {
      known: false,
      refusal: { key: "outcomeUnknown" },
    });
    assert.deepEqual(stripeRefundSendFailure(new TypeError("Failed to fetch")), {
      known: false,
      refusal: { key: "outcomeUnknown" },
    });
    assert.equal(stripeRefundSendFailure(new ORPCError("INTERNAL_SERVER_ERROR")).known, false);
    // A code the dialog does not know proves nothing either.
    assert.deepEqual(stripeRefundSendFailure(failed("RESERVATION_BUSY")), {
      known: false,
      refusal: { key: "outcomeUnknown" },
    });
  });
});

describe("the key of a send, within one dialog", () => {
  const values = {
    paymentId: "pay_1",
    amount: "45.00",
    reason: "requested_by_customer",
    notes: "",
  };
  let made = 0;
  const newKey = () => `key_${++made}`;

  test("the same values sent again are the same request: the same key", () => {
    const first = stripeRefundKeyFor(null, stripeRefundAttemptOf(values), newKey);
    const again = stripeRefundKeyFor(
      first,
      stripeRefundAttemptOf({ ...values, notes: "  " }),
      newKey,
    );
    assert.equal(again.key, first.key);
  });

  test("other values, or the repeat confirmed, are another request: a new key", () => {
    const first = stripeRefundKeyFor(null, stripeRefundAttemptOf(values), newKey);
    for (const other of [
      { ...values, amount: "40.00" },
      { ...values, reason: "duplicate" },
      { ...values, confirmRepeat: true },
    ]) {
      assert.notEqual(
        stripeRefundKeyFor(first, stripeRefundAttemptOf(other), newKey).key,
        first.key,
      );
    }
  });
});

test("the analytics outcome: the refund's state, or the refusal's code", () => {
  assert.equal(stripeRefundOutcomeOf({ status: "pending" }), "pending");
  assert.equal(
    stripeRefundOutcomeOf({
      error: new ORPCError("CONFLICT", { data: { code: "PAYMENT_DISPUTED" } }),
    }),
    "PAYMENT_DISPUTED",
  );
  assert.equal(stripeRefundOutcomeOf({ error: new Error("offline") }), "error");
});

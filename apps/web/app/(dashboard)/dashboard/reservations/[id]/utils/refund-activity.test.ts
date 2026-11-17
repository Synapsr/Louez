import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type RefundActivityContext,
  refundActivityTitleKey,
  refundActivityView,
} from "./refund-activity";

// The history tells a refund of an online payment as a refund of that amount, with who
// approved it when a person did, never as a payment updated: the refund writer, the
// Connect webhook and the refund undone each write a `payment_updated` line of their own
// shape, kept as written.

const owner = { name: "Store owner", email: "owner@example.com", image: null };
const refundRow = (status: string) => ({
  id: "pay_refund",
  type: "rental",
  method: "stripe",
  status,
  amount: "10.00",
  refundOfPaymentId: "pay_charge",
  stripeRefundId: "re_1",
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
});
const context = (
  rowStatus: string,
  operation: "pending" | "succeeded" | "failed" | null,
): RefundActivityContext => ({
  payments: [refundRow(rowStatus)],
  refunds: operation
    ? [{ id: "op_1", refundPaymentId: "pay_refund", status: operation, approvedBy: owner }]
    : [],
});
// The line the refund writer adds once Stripe made the refund.
const operationLine = {
  activityType: "payment_updated",
  metadata: {
    refundOperationId: "op_1",
    paymentId: "pay_refund",
    refundId: "re_1",
    amount: 10,
    currency: "EUR",
  },
};

describe("refundActivityView", () => {
  test("an agent's refund that succeeded: a refund of its amount, approved by the person", () => {
    assert.deepEqual(refundActivityView(operationLine, context("completed", "succeeded")), {
      kind: "refund",
      state: "done",
      amount: 10,
      currency: "EUR",
      approvedBy: owner,
    });
  });

  test("a refund Stripe has not settled is in progress, though its row counts it", () => {
    assert.deepEqual(refundActivityView(operationLine, context("completed", "pending")), {
      kind: "refund",
      state: "processing",
      amount: 10,
      currency: "EUR",
      approvedBy: owner,
    });
  });

  test("a refund Stripe failed afterwards: the same line reads failed", () => {
    assert.deepEqual(refundActivityView(operationLine, context("failed", "failed")), {
      kind: "refund",
      state: "failed",
      amount: 10,
      currency: "EUR",
      approvedBy: owner,
    });
  });

  test("the line Stripe's failure adds is a failed refund of its amount, never money given back", () => {
    const undone = {
      activityType: "payment_updated",
      metadata: {
        kind: "refund_undone",
        paymentId: "pay_refund",
        refundOfPaymentId: "pay_charge",
        refundId: "re_1",
        refundStatus: "failed",
        amount: 10,
        currency: "EUR",
      },
    };
    assert.deepEqual(refundActivityView(undone, context("failed", "failed")), {
      kind: "refund",
      state: "failed",
      amount: 10,
      currency: "EUR",
      approvedBy: owner,
    });
  });

  test("a failed refund Stripe later listed as made asks for a look", () => {
    const listed = {
      activityType: "payment_updated",
      metadata: { kind: "refund_failed_listed", paymentId: "pay_refund", refundId: "re_1" },
    };
    assert.deepEqual(refundActivityView(listed, context("failed", "failed")), { kind: "to_check" });
  });

  test("the webhook's line states what came off the charge in all", () => {
    const line = (isFullRefund: boolean) => ({
      activityType: "payment_updated",
      metadata: { chargeId: "ch_1", refundAmount: 42, isFullRefund },
    });
    assert.deepEqual(refundActivityView(line(true), context("completed", null)), {
      kind: "online_total",
      amount: 42,
      full: true,
    });
    assert.deepEqual(refundActivityView(line(false), context("completed", null)), {
      kind: "online_total",
      amount: 42,
      full: false,
    });
  });

  test("a refund line without its operation (made before operations, or not read) follows its row", () => {
    assert.deepEqual(refundActivityView(operationLine, context("completed", null)), {
      kind: "refund",
      state: "done",
      amount: 10,
      currency: "EUR",
      approvedBy: null,
    });
  });

  test("any other line is not a refund", () => {
    const hold = {
      activityType: "payment_updated",
      metadata: { kind: "deposit_unmatched_intent", attemptId: "a" },
    };
    assert.equal(refundActivityView(hold, context("completed", null)), null);
    assert.equal(
      refundActivityView(
        { activityType: "payment_received", metadata: { amount: 42 } },
        context("completed", null),
      ),
      null,
    );
    // Without payments read, the line's metadata is gone: shown as it is today.
    assert.equal(
      refundActivityView(
        { activityType: "payment_updated", metadata: null },
        { payments: [], refunds: [] },
      ),
      null,
    );
  });
});

test("each refund line has a title of its own, never the generic payment updated", () => {
  const refund = (state: "done" | "processing" | "failed") =>
    refundActivityTitleKey({
      kind: "refund",
      state,
      amount: 10,
      currency: "EUR",
      approvedBy: null,
    });
  assert.equal(refund("done"), "activity.refundDone");
  assert.equal(refund("processing"), "payment.refundProcessing");
  assert.equal(refund("failed"), "activity.refundFailed");
  assert.equal(refundActivityTitleKey({ kind: "to_check" }), "activity.refundToCheck");
  assert.equal(
    refundActivityTitleKey({ kind: "online_total", amount: 42, full: true }),
    "activity.onlineRefundFull",
  );
  assert.equal(
    refundActivityTitleKey({ kind: "online_total", amount: 10, full: false }),
    "activity.onlineRefundTotal",
  );
});

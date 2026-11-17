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

  test("the webhook's line states what Stripe counted then, pending refunds included, never a settlement", () => {
    const line = (refundAmount: number, isFullRefund: boolean) => ({
      activityType: "payment_updated",
      metadata: { chargeId: "ch_1", refundAmount, isFullRefund },
    });
    // 100.00 netted to 75.00 while its 25.00 refund is pending, which then fails: the line
    // keeps Stripe's count of that moment, next to the failed refund's own line.
    assert.deepEqual(refundActivityView(line(25, false), context("failed", null)), {
      kind: "stripe_count",
      amount: 25,
      full: false,
    });
    assert.deepEqual(refundActivityView(line(100, true), context("completed", null)), {
      kind: "stripe_count",
      amount: 100,
      full: true,
    });
    // The oldest webhook wrote the same metadata with a description of its own.
    assert.equal(
      refundActivityView(
        {
          activityType: "payment_updated",
          metadata: { chargeId: "ch_0", refundAmount: 25, isFullRefund: false },
        },
        { payments: [], refunds: [] },
      )?.kind,
      "stripe_count",
    );
  });

  test("an operation's line whose operation is not read follows its row: issued, as Stripe made it", () => {
    assert.deepEqual(refundActivityView(operationLine, context("completed", null)), {
      kind: "refund",
      state: "issued",
      amount: 10,
      currency: "EUR",
      approvedBy: null,
    });
  });

  // The dashboard's Stripe refund before operations (until 2026-10) wrote this shape, with
  // its refund row's id, by a user of the store.
  const dashboardStripeLine = (paymentId: string | null, type = "rental_refund") => ({
    activityType: "payment_updated",
    metadata: { paymentId, refundId: "re_1", amount: 10, type },
  });

  test("the dashboard's Stripe refund before operations reads as a refund, issued at Stripe", () => {
    const row = { ...refundRow("completed"), refundOfPaymentId: null, currency: "EUR" };
    assert.deepEqual(
      refundActivityView(dashboardStripeLine("pay_refund"), { payments: [row], refunds: [] }),
      { kind: "refund", state: "issued", amount: 10, currency: "EUR", approvedBy: null },
    );
    // Its row failed since: failed.
    assert.equal(
      (
        refundActivityView(dashboardStripeLine("pay_refund"), {
          payments: [{ ...row, status: "failed" }],
          refunds: [],
        }) as { state?: string } | null
      )?.state,
      "failed",
    );
    // No row id on the line (its row could not be written then): found by its Stripe refund.
    assert.equal(
      (
        refundActivityView(dashboardStripeLine(null), {
          payments: [{ ...row, status: "failed" }],
          refunds: [],
        }) as { state?: string } | null
      )?.state,
      "failed",
    );
    // No row at all: Stripe made it, nothing says more.
    assert.deepEqual(
      refundActivityView(dashboardStripeLine(null, "deposit_return"), {
        payments: [],
        refunds: [],
      }),
      { kind: "refund", state: "issued", amount: 10, currency: null, approvedBy: null },
    );
  });

  test("a refund recorded by hand from the dashboard reads as made", () => {
    const line = {
      activityType: "payment_updated",
      metadata: {
        paymentId: "pay_cash",
        refundPaymentId: "pay_cash_refund",
        amount: 15,
        method: "cash",
        action: "refunded",
      },
    };
    const row = {
      id: "pay_cash_refund",
      type: "rental",
      method: "cash",
      status: "completed",
      amount: "15.00",
      refundOfPaymentId: "pay_cash",
    };
    assert.deepEqual(refundActivityView(line, { payments: [row], refunds: [] }), {
      kind: "refund",
      state: "done",
      amount: 15,
      currency: null,
      approvedBy: null,
    });
  });

  test("any other line is not a refund", () => {
    const hold = {
      activityType: "payment_updated",
      metadata: { kind: "deposit_unmatched_intent", attemptId: "a" },
    };
    assert.equal(refundActivityView(hold, context("completed", null)), null);
    // A payment deleted from the dashboard is not a refund.
    const deleted = {
      activityType: "payment_updated",
      metadata: { paymentId: "pay_cash", type: "rental", amount: "15.00", action: "deleted" },
    };
    assert.equal(refundActivityView(deleted, context("completed", null)), null);
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
  const refund = (state: "done" | "issued" | "processing" | "failed") =>
    refundActivityTitleKey({
      kind: "refund",
      state,
      amount: 10,
      currency: "EUR",
      approvedBy: null,
    });
  assert.equal(refund("done"), "activity.refundDone");
  assert.equal(refund("issued"), "activity.refundIssued");
  assert.equal(refund("processing"), "payment.refundProcessing");
  assert.equal(refund("failed"), "activity.refundFailed");
  assert.equal(refundActivityTitleKey({ kind: "to_check" }), "activity.refundToCheck");
  assert.equal(
    refundActivityTitleKey({ kind: "stripe_count", amount: 100, full: true }),
    "activity.stripeRefundCountFull",
  );
  assert.equal(
    refundActivityTitleKey({ kind: "stripe_count", amount: 25, full: false }),
    "activity.stripeRefundCount",
  );
});

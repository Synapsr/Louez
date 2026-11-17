import assert from "node:assert/strict";
import { test } from "node:test";

import { customerPaymentBadge } from "./util.payment-badge";

// The customer reads a refund by the reader's word to the end: made, issued, in progress
// or failed, never by the payment status its row holds ("Payé" for a completed row).

test("a refund reads its own state, whatever its row's status", () => {
  for (const status of ["completed", "pending", "failed"]) {
    assert.deepEqual(customerPaymentBadge({ kind: "refund", state: "done" }, status), {
      key: "refundStatus.done",
      variant: "tertiary",
    });
    assert.deepEqual(customerPaymentBadge({ kind: "refund", state: "issued" }, status), {
      key: "refundStatus.issued",
      variant: "info",
    });
    assert.deepEqual(customerPaymentBadge({ kind: "refund", state: "processing" }, status), {
      key: "refundStatus.processing",
      variant: "pending",
    });
    // Left out of the list before it gets here; if it ever does, it still reads failed.
    assert.deepEqual(customerPaymentBadge({ kind: "refund", state: "failed" }, status), {
      key: "refundStatus.failed",
      variant: "failed",
    });
  }
});

test("money paid reads its status, a card hold its hold status", () => {
  assert.deepEqual(customerPaymentBadge({ kind: "receipt" }, "completed"), {
    key: "status.completed",
    variant: "success",
  });
  assert.deepEqual(customerPaymentBadge({ kind: "receipt" }, "refunded", "done"), {
    key: "status.refunded",
    variant: "tertiary",
  });
  assert.deepEqual(customerPaymentBadge({ kind: "hold" }, "authorized"), {
    key: "holdStatus.authorized",
    variant: "info",
  });
});

test("a payment refunded in full is said refunded only once its refunds are known made", () => {
  assert.deepEqual(customerPaymentBadge({ kind: "receipt" }, "refunded", "issued"), {
    key: "refundedStatus.issued",
    variant: "info",
  });
  assert.deepEqual(customerPaymentBadge({ kind: "receipt" }, "refunded", "processing"), {
    key: "refundedStatus.processing",
    variant: "pending",
  });
});

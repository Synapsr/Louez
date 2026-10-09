import assert from "node:assert/strict";
import { test } from "node:test";

import { getCheckoutFailure } from "./util.checkout-failure";

test("cancelled failed checkouts explain the minimum instead of a store decision", () => {
  const metadata = {
    source: "checkout_payment_failed",
    reason: "amount_too_small",
    minimumAmount: 0.5,
    currency: "EUR",
  };
  assert.deepEqual(
    getCheckoutFailure("cancelled", [{ activityType: "cancelled", metadata }]),
    metadata,
  );
});

test("customer cancellations and open requests never acquire a payment failure label", () => {
  assert.equal(
    getCheckoutFailure("cancelled", [
      { activityType: "cancelled", metadata: { source: "customer_request_cancellation" } },
    ]),
    null,
  );
  assert.equal(
    getCheckoutFailure("pending", [
      {
        activityType: "cancelled",
        metadata: { source: "checkout_payment_failed", reason: "session_creation_failed" },
      },
    ]),
    null,
  );
});

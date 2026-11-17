import assert from "node:assert/strict";
import { test } from "node:test";

import { formatPaymentFailureDescription } from "./payment-failure-description";

const t = (key: string) => key;

test("an authorization request the store closed reads as such, not as a declined card", () => {
  assert.deepEqual(
    formatPaymentFailureDescription({
      activityType: "deposit_failed",
      description:
        "Empreinte non confirmée close: la boutique n'a trouvé aucune autorisation chez Stripe",
      metadata: { paymentIntentId: null, attemptId: "attempt_1", closedBy: "store" },
      t,
    }),
    { message: "activity.paymentFailure.deposit_failed.closedByStore" },
  );
});

test("a declined deposit still explains the decline", () => {
  assert.deepEqual(
    formatPaymentFailureDescription({
      activityType: "deposit_failed",
      description: null,
      metadata: { paymentIntentId: "pi_1", error: "Your card was declined." },
      t,
    }),
    {
      message: "activity.paymentFailure.deposit_failed.cardDeclined",
      technicalMessage: "Your card was declined.",
    },
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyPaymentMovement,
  isStripeRefundRow,
  type PaymentMovementContext,
  type PaymentMovementRow,
} from "./util.payment-movement";

const charge = (amount: string, overrides: Partial<PaymentMovementRow> = {}) =>
  ({
    type: "rental",
    status: "completed",
    amount,
    refundOfPaymentId: null,
    stripeRefundId: null,
    stripePaymentIntentId: "pi_1",
    stripeCheckoutSessionId: null,
    ...overrides,
  }) satisfies PaymentMovementRow;

const cash = (amount: string, overrides: Partial<PaymentMovementRow> = {}) =>
  charge(amount, { stripePaymentIntentId: null, ...overrides });

const stripeRefund = (amount: string, overrides: Partial<PaymentMovementRow> = {}) =>
  cash(amount, { stripeRefundId: "re_1", ...overrides });

/** Net of the ledger over a set of rows, the way the screen totals a period. */
const net = (rows: [PaymentMovementRow, PaymentMovementContext?][]) =>
  rows.reduce((sum, [row, context]) => {
    const movement = classifyPaymentMovement(row, context);
    return movement.kind === "settled" ? sum + movement.amount : sum;
  }, 0);

test("a Stripe payment refunded in full reads +100 then −100", () => {
  // The webhook brought the charge down to 0 and flagged it `refunded`.
  const original = charge("0.00", { status: "refunded" });
  const refund = stripeRefund("100.00", { refundOfPaymentId: "original" });

  assert.deepEqual(classifyPaymentMovement(original, { linkedStripeRefunds: 100 }), {
    kind: "settled",
    direction: "in",
    nature: "rental",
    amount: 100,
  });
  assert.deepEqual(classifyPaymentMovement(refund), {
    kind: "settled",
    direction: "out",
    nature: "refund",
    amount: -100,
  });
  assert.equal(net([[original, { linkedStripeRefunds: 100 }], [refund]]), 0);
});

test("a partial Stripe refund of 30 reads +100 then −30, net 70", () => {
  const original = charge("70.00");
  const refund = stripeRefund("30.00", { refundOfPaymentId: "original" });

  const receipt = classifyPaymentMovement(original, { linkedStripeRefunds: 30 });
  assert.equal(receipt.kind === "settled" && receipt.amount, 100);
  assert.equal(net([[original, { linkedStripeRefunds: 30 }], [refund]]), 70);
});

test("a manual refund leaves its cash payment gross", () => {
  const original = cash("100.00");
  const refund = cash("30.00", { refundOfPaymentId: "original" });

  assert.deepEqual(classifyPaymentMovement(original), {
    kind: "settled",
    direction: "in",
    nature: "rental",
    amount: 100,
  });
  assert.deepEqual(classifyPaymentMovement(refund), {
    kind: "settled",
    direction: "out",
    nature: "refund",
    amount: -30,
  });
  assert.equal(net([[original], [refund]]), 70);
});

test("an unlinked legacy Stripe refund still goes out, its charge stays net", () => {
  const original = charge("70.00");
  const refund = stripeRefund("30.00");

  assert.equal(net([[original], [refund]]), 40);
  assert.equal(classifyPaymentMovement(refund).kind, "settled");
});

test("a refund id stamped on a netted charge by an old webhook is still a receipt", () => {
  const legacyOriginal = charge("70.00", { stripeRefundId: "re_legacy" });

  assert.equal(isStripeRefundRow(legacyOriginal), false);
  assert.deepEqual(classifyPaymentMovement(legacyOriginal), {
    kind: "settled",
    direction: "in",
    nature: "rental",
    amount: 70,
  });
});

test("a row loaded without its Stripe ids is never taken for a refund", () => {
  assert.equal(isStripeRefundRow({ stripeRefundId: "re_1" }), false);
  assert.equal(
    classifyPaymentMovement({
      type: "rental",
      status: "completed",
      amount: 50,
      stripeRefundId: "re_1",
    }).kind === "settled",
    true,
  );
});

test("pending and authorised rows are listed, never counted", () => {
  assert.deepEqual(classifyPaymentMovement(charge("80.00", { status: "pending" })), {
    kind: "unsettled",
    state: "pending",
    nature: "rental",
    amount: 80,
  });
  assert.deepEqual(
    classifyPaymentMovement(charge("500.00", { type: "deposit_hold", status: "authorized" })),
    { kind: "unsettled", state: "held", nature: "deposit_hold", amount: 500 },
  );
  assert.equal(net([[charge("80.00", { status: "pending" })]]), 0);
});

test("failed and cancelled rows are ignored", () => {
  assert.deepEqual(classifyPaymentMovement(charge("80.00", { status: "failed" })), {
    kind: "ignored",
  });
  assert.deepEqual(
    classifyPaymentMovement(charge("500.00", { type: "deposit_hold", status: "cancelled" })),
    { kind: "ignored" },
  );
});

test("a captured hold is dropped in favour of its capture row", () => {
  const hold = charge("500.00", { type: "deposit_hold" });
  const capture = charge("120.00", { type: "deposit_capture" });

  assert.deepEqual(classifyPaymentMovement(hold, { depositCaptured: true }), { kind: "ignored" });
  assert.deepEqual(classifyPaymentMovement(capture, { depositCaptured: true }), {
    kind: "settled",
    direction: "in",
    nature: "deposit_capture",
    amount: 120,
  });
  assert.equal(
    net([
      [hold, { depositCaptured: true }],
      [capture, { depositCaptured: true }],
    ]),
    120,
  );
});

test("a cash deposit comes in and its return goes out", () => {
  const deposit = cash("300.00", { type: "deposit" });
  const depositReturn = cash("300.00", { type: "deposit_return" });

  assert.deepEqual(classifyPaymentMovement(depositReturn), {
    kind: "settled",
    direction: "out",
    nature: "deposit_return",
    amount: -300,
  });
  assert.equal(net([[deposit], [depositReturn]]), 0);
});

test("the refund of a capture is a deposit given back, not a generic refund", () => {
  const refund = cash("50.00", { type: "deposit_return", refundOfPaymentId: "capture" });
  const movement = classifyPaymentMovement(refund);

  assert.equal(movement.kind === "settled" && movement.nature, "deposit_return");
  assert.equal(movement.kind === "settled" && movement.amount, -50);
});

test("a negative adjustment is money out, a positive one money in", () => {
  assert.deepEqual(classifyPaymentMovement(cash("-12.50", { type: "adjustment" })), {
    kind: "settled",
    direction: "out",
    nature: "adjustment",
    amount: -12.5,
  });
  assert.deepEqual(classifyPaymentMovement(cash("12.50", { type: "adjustment" })), {
    kind: "settled",
    direction: "in",
    nature: "adjustment",
    amount: 12.5,
  });
});

test("damage fees come in and amounts are rounded to the cent", () => {
  const movement = classifyPaymentMovement(cash("0.1", { type: "damage" }), {
    linkedStripeRefunds: 0.2,
  });

  assert.equal(movement.kind === "settled" && movement.amount, 0.3);
});

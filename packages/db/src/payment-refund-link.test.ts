import assert from "node:assert/strict";
import { test } from "node:test";

import { pickRefundOriginal, type RefundLinkPayment } from "./payment-refund-link";

const payment = (overrides: Partial<RefundLinkPayment> & { id: string }): RefundLinkPayment => ({
  type: "rental",
  status: "completed",
  stripeChargeId: null,
  stripeRefundId: null,
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
  ...overrides,
});

const charge = (id: string, overrides: Partial<RefundLinkPayment> = {}) =>
  payment({ id, stripePaymentIntentId: `pi_${id}`, stripeChargeId: `ch_${id}`, ...overrides });

const refund = (overrides: Partial<RefundLinkPayment> = {}) =>
  payment({ id: "refund", stripeRefundId: "re_1", ...overrides });

test("the charge id settles it, even with two Stripe charges on the reservation", () => {
  const row = refund({ stripeChargeId: "ch_balance" });
  const result = pickRefundOriginal(row, [charge("deposit"), charge("balance"), row]);

  assert.deepEqual(result, { status: "linked", originalId: "balance", matchedBy: "charge" });
});

test("a charge id that matches nothing is reported, not replaced by a guess", () => {
  const row = refund({ stripeChargeId: "ch_unknown" });

  assert.deepEqual(pickRefundOriginal(row, [charge("only"), row]), {
    status: "ambiguous",
    reason: "no_candidate",
    candidateIds: [],
  });
});

test("without a charge id, the single Stripe charge of the same nature is the original", () => {
  const row = refund();
  const result = pickRefundOriginal(row, [
    charge("rental", { status: "refunded" }),
    charge("capture", { type: "deposit_capture" }),
    payment({ id: "cash" }),
    row,
  ]);

  assert.deepEqual(result, { status: "linked", originalId: "rental", matchedBy: "reservation" });
});

test("two possible charges are listed and left alone", () => {
  const row = refund();

  assert.deepEqual(pickRefundOriginal(row, [charge("down"), charge("balance"), row]), {
    status: "ambiguous",
    reason: "several_candidates",
    candidateIds: ["down", "balance"],
  });
});

test("a deposit return only matches a cashed deposit or a capture, never a hold or the rental", () => {
  const row = refund({ type: "deposit_return" });

  assert.deepEqual(
    pickRefundOriginal(row, [charge("rental"), charge("hold", { type: "deposit_hold" }), row]),
    { status: "ambiguous", reason: "no_candidate", candidateIds: [] },
  );
  assert.deepEqual(
    pickRefundOriginal(row, [
      charge("rental"),
      charge("capture", { type: "deposit_capture" }),
      row,
    ]),
    { status: "linked", originalId: "capture", matchedBy: "reservation" },
  );
});

test("charges that never went through and other refund rows are not candidates", () => {
  const row = refund();
  const otherRefund = payment({ id: "other-refund", stripeRefundId: "re_2" });

  assert.deepEqual(
    pickRefundOriginal(row, [charge("failed", { status: "failed" }), otherRefund, row]),
    { status: "ambiguous", reason: "no_candidate", candidateIds: [] },
  );
});

test("a netted charge stamped with a refund id by an old webhook is still a charge", () => {
  const row = refund();
  const legacy = charge("legacy", { stripeRefundId: "re_legacy" });

  assert.deepEqual(pickRefundOriginal(row, [legacy, row]), {
    status: "linked",
    originalId: "legacy",
    matchedBy: "reservation",
  });
});

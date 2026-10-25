import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type DisputeInput,
  type DisputeStatus,
  mapDisputeStatus,
  mergeDispute,
  readDisputeFacts,
} from "./dispute-facts";

// Stripe disputes as billing facts (louez-billing docs/api, README Q15).

const CREATED = Date.UTC(2026, 9, 1, 10) / 1000;
const WITHDRAWN = Date.UTC(2026, 9, 1, 10, 0, 5) / 1000;
const REINSTATED = Date.UTC(2026, 10, 20, 9) / 1000;
const EVENT_AT = new Date(Date.UTC(2026, 10, 20, 9, 0, 30));

function dispute(overrides: Partial<DisputeInput> = {}): DisputeInput {
  return {
    id: "dp_1",
    amount: 12_345,
    currency: "eur",
    created: CREATED,
    charge: "ch_1",
    payment_intent: "pi_1",
    status: "needs_response",
    balance_transactions: [{ amount: -12_345, created: WITHDRAWN }],
    ...overrides,
  };
}

describe("mapDisputeStatus", () => {
  test("chargebacks map to open, won and lost", () => {
    const cases: ReadonlyArray<readonly [string, DisputeStatus]> = [
      ["needs_response", "open"],
      ["under_review", "open"],
      ["won", "won"],
      ["lost", "lost"],
    ];
    for (const [stripeStatus, status] of cases) {
      const rule = mapDisputeStatus(stripeStatus);
      assert.equal(rule.status, status, stripeStatus);
      assert.equal(rule.withdrawsFunds, true, stripeStatus);
      assert.equal(rule.known, true, stripeStatus);
    }
  });

  test("inquiries, prevented and charge_refunded withdraw nothing", () => {
    for (const stripeStatus of [
      "warning_needs_response",
      "warning_under_review",
      "warning_closed",
      "prevented",
      "charge_refunded",
    ]) {
      const rule = mapDisputeStatus(stripeStatus);
      assert.equal(rule.withdrawsFunds, false, stripeStatus);
      assert.equal(rule.known, true, stripeStatus);
    }
  });

  test("an unknown status counts as open and is flagged", () => {
    assert.deepEqual(mapDisputeStatus("something_new"), {
      status: "open",
      withdrawsFunds: true,
      stage: 1,
      known: false,
    });
  });
});

describe("readDisputeFacts", () => {
  test("a chargeback opens when Stripe withdrew the funds", () => {
    const facts = readDisputeFacts({
      dispute: dispute(),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
    });
    assert.deepEqual(facts, {
      disputeId: "dp_1",
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      amountMinor: 12_345,
      currency: "EUR",
      status: "open",
      stripeStatus: "needs_response",
      knownStatus: true,
      openedAt: new Date(WITHDRAWN * 1000),
      closedAt: null,
    });
  });

  test("a chargeback without a withdrawal yet stays unopened until funds_withdrawn", () => {
    const pending = readDisputeFacts({
      dispute: dispute({ balance_transactions: [] }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
    });
    assert.equal(pending.openedAt, null);

    const withdrawn = readDisputeFacts({
      dispute: dispute({ balance_transactions: [] }),
      eventType: "charge.dispute.funds_withdrawn",
      eventCreatedAt: EVENT_AT,
    });
    assert.deepEqual(withdrawn.openedAt, EVENT_AT);
  });

  test("an inquiry is never opened, whatever its balance transactions", () => {
    const facts = readDisputeFacts({
      dispute: dispute({ status: "warning_needs_response" }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
    });
    assert.equal(facts.openedAt, null);
    assert.equal(facts.closedAt, null);
  });

  test("a won dispute closes when the funds came back", () => {
    const facts = readDisputeFacts({
      dispute: dispute({
        status: "won",
        balance_transactions: [
          { amount: 12_345, created: REINSTATED },
          { amount: -12_345, created: WITHDRAWN },
        ],
      }),
      eventType: "charge.dispute.closed",
      eventCreatedAt: EVENT_AT,
    });
    assert.equal(facts.status, "won");
    assert.deepEqual(facts.openedAt, new Date(WITHDRAWN * 1000));
    assert.deepEqual(facts.closedAt, new Date(REINSTATED * 1000));
  });

  test("a lost dispute closes at the event", () => {
    const facts = readDisputeFacts({
      dispute: dispute({ status: "lost" }),
      eventType: "charge.dispute.closed",
      eventCreatedAt: EVENT_AT,
    });
    assert.equal(facts.status, "lost");
    assert.deepEqual(facts.closedAt, EVENT_AT);
  });

  test("an unknown status counts from the dispute's creation when no withdrawal is shown", () => {
    const facts = readDisputeFacts({
      dispute: dispute({ status: "something_new", balance_transactions: [] }),
      eventType: "charge.dispute.updated",
      eventCreatedAt: EVENT_AT,
    });
    assert.equal(facts.knownStatus, false);
    assert.equal(facts.status, "open");
    assert.deepEqual(facts.openedAt, new Date(CREATED * 1000));
  });

  test("a dispute on a charge without a PaymentIntent has no PaymentIntent id", () => {
    const facts = readDisputeFacts({
      dispute: dispute({ payment_intent: null }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
    });
    assert.equal(facts.chargeId, "ch_1");
    assert.equal(facts.paymentIntentId, null);
  });
});

describe("mergeDispute", () => {
  const open = readDisputeFacts({
    dispute: dispute(),
    eventType: "charge.dispute.created",
    eventCreatedAt: EVENT_AT,
  });
  const won = readDisputeFacts({
    dispute: dispute({
      status: "won",
      balance_transactions: [
        { amount: -12_345, created: WITHDRAWN },
        { amount: 12_345, created: REINSTATED },
      ],
    }),
    eventType: "charge.dispute.closed",
    eventCreatedAt: EVENT_AT,
  });

  test("a first event is stored as it is", () => {
    assert.deepEqual(mergeDispute(null, open), {
      amountMinor: 12_345,
      currency: "EUR",
      status: "open",
      stripeStatus: "needs_response",
      openedAt: new Date(WITHDRAWN * 1000),
      closedAt: null,
    });
  });

  test("a later stage replaces the status and keeps the withdrawal time", () => {
    assert.deepEqual(mergeDispute(mergeDispute(null, open), won), {
      amountMinor: 12_345,
      currency: "EUR",
      status: "won",
      stripeStatus: "won",
      openedAt: new Date(WITHDRAWN * 1000),
      closedAt: new Date(REINSTATED * 1000),
    });
  });

  test("an older event delivered late never reopens a closed dispute", () => {
    const closed = mergeDispute(null, won);
    assert.deepEqual(mergeDispute(closed, open), closed);
  });

  test("an inquiry that becomes a chargeback is opened from then on", () => {
    const inquiry = readDisputeFacts({
      dispute: dispute({ status: "warning_under_review", balance_transactions: [] }),
      eventType: "charge.dispute.created",
      eventCreatedAt: EVENT_AT,
    });
    const stored = mergeDispute(null, inquiry);
    assert.equal(stored.openedAt, null);
    const escalated = mergeDispute(stored, open);
    assert.equal(escalated.status, "open");
    assert.equal(escalated.stripeStatus, "needs_response");
    assert.deepEqual(escalated.openedAt, new Date(WITHDRAWN * 1000));
  });
});

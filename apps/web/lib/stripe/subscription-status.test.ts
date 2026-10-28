import assert from "node:assert/strict";
import { test } from "node:test";

import type Stripe from "stripe";

import {
  hasLiveSubscription,
  rowStatus,
  subscriptionEnded,
  subscriptionHoldsPlan,
} from "./subscription-status";

// The row status of every Stripe subscription status (louez-billing docs/api, README
// §8.7): strict for a store the billing service bills, today's reading otherwise.

const EVERY_STATUS: ReadonlyArray<
  readonly [Stripe.Subscription.Status, { readonly service: string; readonly legacy: string }]
> = [
  ["active", { service: "active", legacy: "active" }],
  ["trialing", { service: "trialing", legacy: "trialing" }],
  ["past_due", { service: "past_due", legacy: "past_due" }],
  ["canceled", { service: "cancelled", legacy: "cancelled" }],
  ["unpaid", { service: "cancelled", legacy: "active" }],
  ["incomplete", { service: "cancelled", legacy: "active" }],
  ["incomplete_expired", { service: "cancelled", legacy: "active" }],
  ["paused", { service: "cancelled", legacy: "active" }],
];

test("a store the service bills keeps a plan in force only while Stripe collects it", () => {
  for (const [stripeStatus, expected] of EVERY_STATUS) {
    assert.equal(rowStatus(stripeStatus, true), expected.service, stripeStatus);
  }
});

test("a store Louez's legacy code bills keeps today's reading", () => {
  for (const [stripeStatus, expected] of EVERY_STATUS) {
    assert.equal(rowStatus(stripeStatus, false), expected.legacy, stripeStatus);
  }
});

test("at a completed checkout, today's reading is still trialing, else active", () => {
  for (const stripeStatus of ["active", "trialing", "incomplete"] as const) {
    assert.equal(
      rowStatus(stripeStatus, false),
      stripeStatus === "trialing" ? "trialing" : "active",
    );
  }
});

test("only canceled and incomplete_expired are ended; a plan is held by what the row reads as in force", () => {
  for (const [stripeStatus, expected] of EVERY_STATUS) {
    const ended = stripeStatus === "canceled" || stripeStatus === "incomplete_expired";
    assert.equal(subscriptionEnded(stripeStatus), ended, stripeStatus);
    assert.equal(
      subscriptionHoldsPlan(stripeStatus, true),
      expected.service !== "cancelled",
      `service ${stripeStatus}`,
    );
    assert.equal(subscriptionHoldsPlan(stripeStatus, false), !ended, `legacy ${stripeStatus}`);
  }
});

test("a subscription is live while the row holds one that is not cancelled", () => {
  const live = { stripeSubscriptionId: "sub_test", status: "active" } as const;
  assert.equal(hasLiveSubscription(live), true);
  for (const status of ["trialing", "past_due"] as const) {
    assert.equal(hasLiveSubscription({ ...live, status }), true, status);
  }
  assert.equal(hasLiveSubscription({ ...live, status: "cancelled" }), false);
  assert.equal(hasLiveSubscription({ ...live, stripeSubscriptionId: null }), false);
  assert.equal(hasLiveSubscription(null), false);
});

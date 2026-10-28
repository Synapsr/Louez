import assert from "node:assert/strict";
import { test } from "node:test";

import type Stripe from "stripe";

import { rowStatus } from "./subscription-status";

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
    assert.equal(rowStatus(stripeStatus, false), stripeStatus === "trialing" ? "trialing" : "active");
  }
});

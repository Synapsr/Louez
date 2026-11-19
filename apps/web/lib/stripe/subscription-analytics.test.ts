import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type AnalyticsPrice,
  type AnalyticsSubscription,
  type PlanOfPrice,
  subscriptionCanceled,
  subscriptionChanged,
  subscriptionStarted,
} from "./subscription-analytics";

const prices: Record<string, AnalyticsPrice> = {
  pro_m: { id: "pro_m", unit_amount: 2900, currency: "eur", recurring: { interval: "month" } },
  pro_y: { id: "pro_y", unit_amount: 29000, currency: "eur", recurring: { interval: "year" } },
  ultra_m: { id: "ultra_m", unit_amount: 7900, currency: "eur", recurring: { interval: "month" } },
  unknown: { id: "unknown", unit_amount: 1000, currency: "usd", recurring: { interval: "month" } },
};
/** The plans, and Pro monthly's amount in GBP, an option of its EUR price. */
const planOf: PlanOfPrice = (id, currency) =>
  ({
    pro_m: { plan: "pro", interval: "monthly" as const, amountMinor: currency === "gbp" ? 3900 : null },
    pro_y: { plan: "pro", interval: "yearly" as const, amountMinor: null },
    ultra_m: { plan: "ultra", interval: "monthly" as const, amountMinor: null },
  })[id] ?? null;

const subscription = (
  price: AnalyticsPrice,
  overrides: Partial<AnalyticsSubscription> = {},
): AnalyticsSubscription => ({
  id: "sub_1",
  currency: price.currency,
  status: "active",
  cancel_at_period_end: false,
  items: { data: [{ price, quantity: 1 }] },
  ...overrides,
});

describe("subscription_started", () => {
  test("names the plan, interval, amounts and currency Stripe bills", () => {
    assert.deepEqual(subscriptionStarted(subscription(prices.pro_y!), planOf), {
      event: "subscription_started",
      properties: {
        plan: "pro",
        interval: "yearly",
        amount_cents: 29000,
        mrr_cents: 2417,
        currency: "EUR",
        subscription_status: "active",
        is_trial: false,
      },
    });
  });

  test("a subscription in another currency than its price's says what it pays in it", () => {
    const started = subscriptionStarted(subscription(prices.pro_m!, { currency: "gbp" }), planOf);
    assert.equal(started.properties.plan, "pro");
    assert.equal(started.properties.amount_cents, 3900);
    assert.equal(started.properties.mrr_cents, 3900);
    assert.equal(started.properties.currency, "GBP");
    // Without the plan's amount in it, no amount rather than the EUR one.
    const unknown = subscriptionStarted(subscription(prices.ultra_m!, { currency: "gbp" }), planOf);
    assert.equal(unknown.properties.amount_cents, null);
  });

  test("a trial says so; a price no plan has keeps Stripe's interval", () => {
    const started = subscriptionStarted(
      subscription(prices.unknown!, { status: "trialing" }),
      planOf,
    );
    assert.equal(started.properties.plan, null);
    assert.equal(started.properties.interval, "monthly");
    assert.equal(started.properties.currency, "USD");
    assert.equal(started.properties.is_trial, true);
  });
});

describe("subscription_changed", () => {
  test("another plan", () => {
    const changed = subscriptionChanged(
      subscription(prices.ultra_m!),
      { items: { data: [{ price: prices.pro_m!, quantity: 1 }] } },
      planOf,
    );
    assert.deepEqual(changed?.properties, {
      change_type: "plan",
      plan: "ultra",
      interval: "monthly",
      amount_cents: 7900,
      mrr_cents: 7900,
      currency: "EUR",
      previous_plan: "pro",
      previous_interval: "monthly",
      previous_amount_cents: 2900,
      subscription_status: "active",
      cancel_at_period_end: false,
    });
  });

  test("the same plan, another interval", () => {
    const changed = subscriptionChanged(
      subscription(prices.pro_y!),
      { items: { data: [{ price: prices.pro_m!, quantity: 1 }] } },
      planOf,
    );
    assert.equal(changed?.properties.change_type, "interval");
    assert.equal(changed?.properties.previous_interval, "monthly");
  });

  test("a cancellation scheduled, then taken back", () => {
    const scheduled = subscriptionChanged(
      subscription(prices.pro_m!, { cancel_at_period_end: true }),
      { cancel_at_period_end: false },
      planOf,
    );
    assert.equal(scheduled?.properties.change_type, "cancellation_scheduled");
    assert.equal("previous_plan" in (scheduled?.properties ?? {}), false);
    const reverted = subscriptionChanged(
      subscription(prices.pro_m!),
      { cancel_at_period_end: true },
      planOf,
    );
    assert.equal(reverted?.properties.change_type, "cancellation_reverted");
  });

  test("a trial that became a paid plan", () => {
    const converted = subscriptionChanged(
      subscription(prices.pro_m!),
      { status: "trialing" },
      planOf,
    );
    assert.equal(converted?.properties.change_type, "trial_converted");
  });

  test("a renewal, a retry or no previous attributes change no plan", () => {
    for (const previous of [undefined, null, {}, { status: "past_due" }]) {
      assert.equal(subscriptionChanged(subscription(prices.pro_m!), previous, planOf), null);
    }
    // Items sent back unchanged (the same price and quantity).
    assert.equal(
      subscriptionChanged(
        subscription(prices.pro_m!),
        { items: { data: [{ price: prices.pro_m!, quantity: 1 }] } },
        planOf,
      ),
      null,
    );
  });
});

describe("subscription_canceled", () => {
  test("the plan that ended and why", () => {
    const canceled = subscriptionCanceled(
      subscription(prices.pro_m!, {
        status: "canceled",
        cancellation_details: { reason: "payment_failed" },
        metadata: {},
      }),
      planOf,
    );
    assert.equal(canceled.event, "subscription_canceled");
    assert.equal(canceled.properties.plan, "pro");
    assert.equal(canceled.properties.cancellation_reason, "payment_failed");
    assert.equal(canceled.properties.owner_scheduled_switch, false);
  });

  test("the owner's switch to pay-as-you-go, without the items", () => {
    const canceled = subscriptionCanceled(
      {
        id: "sub_1",
        currency: "eur",
        status: "canceled",
        cancel_at_period_end: true,
        items: { data: [] },
        metadata: { pendingBillingMode: "pay_as_you_go" },
      },
      planOf,
    );
    assert.equal(canceled.properties.plan, null);
    assert.equal(canceled.properties.owner_scheduled_switch, true);
  });
});

import type Stripe from "stripe";

import type { subscriptions } from "@louez/db";

/** The `status` column of a store's `subscriptions` row. */
export type SubscriptionRowStatus = (typeof subscriptions.$inferSelect)["status"];

/**
 * The row status of a Stripe subscription status (louez-billing docs/api, README §8.7).
 *
 * For a store the billing service bills, only a subscription Stripe still collects
 * keeps its plan in force: `active`, `trialing` and `past_due`, Stripe's retry window,
 * stay as they are, and any other status is `cancelled`. Otherwise, today's reading:
 * `past_due`, `canceled` and `trialing` as they are, any other status `active`. At a
 * completed checkout that equals "`trialing`, else `active`".
 */
export function rowStatus(
  stripeStatus: Stripe.Subscription.Status,
  serviceBills: boolean,
): SubscriptionRowStatus {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "cancelled";
    // `unpaid`, `incomplete`, `incomplete_expired`, `paused`, and any status Stripe adds.
    default:
      return serviceBills ? "cancelled" : "active";
  }
}

/** Stripe statuses a subscription never leaves. */
const ENDED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "canceled",
  "incomplete_expired",
]);

/** Whether Stripe has ended the subscription for good: it never bills again. */
export function subscriptionEnded(stripeStatus: Stripe.Subscription.Status): boolean {
  return ENDED_STATUSES.has(stripeStatus);
}

/**
 * Whether a subscription in this Stripe status still holds the store's plan: Stripe
 * has not ended it, and the store's row would not read it as `cancelled` (rowStatus).
 */
export function subscriptionHoldsPlan(
  stripeStatus: Stripe.Subscription.Status,
  serviceBills: boolean,
): boolean {
  return !subscriptionEnded(stripeStatus) && rowStatus(stripeStatus, serviceBills) !== "cancelled";
}

type LiveSubscriptionRow = {
  readonly stripeSubscriptionId: string | null;
  readonly status: SubscriptionRowStatus;
};

/**
 * Whether the row holds a Stripe subscription that is not over. Then a plan checkout
 * is refused, and a plan change swaps that subscription's price instead, so a store
 * never pays two plans (plans-for-new-stores decision 5).
 */
export function hasLiveSubscription<Row extends LiveSubscriptionRow>(
  row: Row | null | undefined,
): row is Row & { readonly stripeSubscriptionId: string } {
  return Boolean(row?.stripeSubscriptionId) && row?.status !== "cancelled";
}

import type { StoreLifecycleEvent } from "@louez/api/platform/effects";

// What the platform webhook's plan events say to analytics (docs/analytics/lifecycle.md):
// a plan started, changed or canceled, with its plan, interval, amount and currency as
// Stripe bills it. Pure, so the decisions are tested without Stripe: the webhook
// (lib/stripe/subscription-webhooks.ts) queues what these answer.

/** What these read of a Stripe price. */
export interface AnalyticsPrice {
  readonly id: string;
  readonly unit_amount: number | null;
  readonly currency: string;
  readonly recurring: { readonly interval: string; readonly interval_count?: number } | null;
}

/** What these read of a Stripe subscription. */
export interface AnalyticsSubscription {
  readonly id: string;
  readonly status: string;
  readonly cancel_at_period_end: boolean;
  readonly items: {
    readonly data: ReadonlyArray<{ readonly price: AnalyticsPrice; readonly quantity?: number }>;
  };
  readonly cancellation_details?: { readonly reason?: string | null } | null;
  readonly metadata?: Record<string, string> | null;
}

/** The plan a price bills, as lib/plans.ts `findPlanPrice` finds it; null for none. */
export type PlanOfPrice = (
  priceId: string,
) => { plan: string; interval: "monthly" | "yearly" } | null;

export interface LifecycleAnalytic {
  event: StoreLifecycleEvent;
  properties: Record<string, string | number | boolean | null>;
}

const intervalOf = (price: AnalyticsPrice, planOf: PlanOfPrice): string | null => {
  const billed = planOf(price.id);
  if (billed) return billed.interval;
  const interval = price.recurring?.interval;
  if (interval === "month") return "monthly";
  if (interval === "year") return "yearly";
  return interval ?? null;
};

/** Plan, interval, amount (in cents, per period and per month) and currency of a price. */
export function priceProperties(
  price: AnalyticsPrice | undefined,
  quantity: number | undefined,
  planOf: PlanOfPrice,
): Record<string, string | number | null> {
  if (!price)
    return { plan: null, interval: null, amount_cents: null, mrr_cents: null, currency: null };
  const interval = intervalOf(price, planOf);
  const amount = typeof price.unit_amount === "number" ? price.unit_amount * (quantity ?? 1) : null;
  const months =
    interval === "yearly"
      ? 12
      : interval === "monthly"
        ? (price.recurring?.interval_count ?? 1)
        : null;
  return {
    plan: planOf(price.id)?.plan ?? null,
    interval,
    amount_cents: amount,
    mrr_cents: amount !== null && months ? Math.round(amount / months) : null,
    currency: price.currency.toUpperCase(),
  };
}

const firstItem = (subscription: Pick<AnalyticsSubscription, "items">) =>
  subscription.items.data[0];

/** `subscription_started`: a plan bought through Checkout that Louez wrote on the store. */
export function subscriptionStarted(
  subscription: AnalyticsSubscription,
  planOf: PlanOfPrice,
): LifecycleAnalytic {
  const item = firstItem(subscription);
  return {
    event: "subscription_started",
    properties: {
      ...priceProperties(item?.price, item?.quantity, planOf),
      subscription_status: subscription.status,
      is_trial: subscription.status === "trialing",
    },
  };
}

/**
 * `subscription_changed` of a `customer.subscription.updated` event, from what Stripe
 * says changed (`previous_attributes`): another price (`change_type` `plan` when the
 * plan differs, `interval` when only the billing period does), a cancellation the owner
 * scheduled for the period's end or took back, or a trial that turned into a paid plan.
 * Null for what changes no plan: a renewal, a payment retry, a metadata update.
 */
export function subscriptionChanged(
  subscription: AnalyticsSubscription,
  previous:
    | Partial<{
        items: { data: ReadonlyArray<{ price: AnalyticsPrice; quantity?: number }> };
        cancel_at_period_end: boolean;
        status: string;
      }>
    | null
    | undefined,
  planOf: PlanOfPrice,
): LifecycleAnalytic | null {
  if (!previous) return null;
  const item = firstItem(subscription);
  const current = priceProperties(item?.price, item?.quantity, planOf);
  const before = previous.items?.data[0];
  let changeType: string | null = null;
  let was: Record<string, string | number | null> = {};

  if (before && item && (before.price.id !== item.price.id || before.quantity !== item.quantity)) {
    was = priceProperties(before.price, before.quantity, planOf);
    changeType =
      was.plan !== current.plan ? "plan" : was.interval !== current.interval ? "interval" : "price";
  } else if (
    previous.cancel_at_period_end !== undefined &&
    previous.cancel_at_period_end !== subscription.cancel_at_period_end
  ) {
    changeType = subscription.cancel_at_period_end
      ? "cancellation_scheduled"
      : "cancellation_reverted";
  } else if (previous.status === "trialing" && subscription.status === "active") {
    changeType = "trial_converted";
  }
  if (!changeType) return null;

  return {
    event: "subscription_changed",
    properties: {
      change_type: changeType,
      ...current,
      ...(changeType === "plan" || changeType === "interval" || changeType === "price"
        ? {
            previous_plan: was.plan ?? null,
            previous_interval: was.interval ?? null,
            previous_amount_cents: was.amount_cents ?? null,
          }
        : {}),
      subscription_status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
  };
}

/** `subscription_canceled`: the subscription ended and the store is back on pay-as-you-go. */
export function subscriptionCanceled(
  subscription: AnalyticsSubscription,
  planOf: PlanOfPrice,
): LifecycleAnalytic {
  const item = firstItem(subscription);
  return {
    event: "subscription_canceled",
    properties: {
      ...priceProperties(item?.price, item?.quantity, planOf),
      // Stripe's reason: cancellation_requested, payment_failed, payment_disputed.
      cancellation_reason: subscription.cancellation_details?.reason ?? null,
      // The owner chose pay-as-you-go from the plan page, rather than a lapse or a cancel in Stripe.
      owner_scheduled_switch: subscription.metadata?.pendingBillingMode === "pay_as_you_go",
    },
  };
}

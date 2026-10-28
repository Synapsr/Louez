import type Stripe from "stripe";

import { eq } from "drizzle-orm";

import { db, legacyBillingAppliesAt, markSubscriptionRow, stores, subscriptions } from "@louez/db";

import {
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
} from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { findPlanPrice, getPlans } from "@/lib/plans";
import { stripe } from "@/lib/stripe/client";
import { rowStatus } from "@/lib/stripe/subscription-status";
import { activatePlanSubscription, endSubscriptionToPayAsYouGo } from "@/lib/stripe/subscriptions";

// The platform webhook's plan events (app/api/webhooks/stripe/route.ts): a plan bought
// through Checkout, a subscription Stripe updated, and its end. Each row write marks
// the store's snapshots (markSubscriptionRow).
//
// Stripe may deliver an event late, twice or out of order, and redelivers one the
// webhook failed. So the checkout and update handlers read the subscription from
// Stripe as it is now, never the copy in the event: an old copy would bring back a plan
// or a status Stripe no longer bills. The end needs no read: a deleted subscription
// never comes back.

/** The Stripe subscription an event is about. */
type SubscriptionRef = { readonly id: string };

/** What the checkout handler reads of a completed Checkout Session in subscription mode. */
export type SubscriptionCheckoutSession = {
  readonly metadata: Stripe.Metadata | null;
  readonly subscription: string | { readonly id: string } | null;
  readonly customer: string | { readonly id: string } | null;
};

/** Stripe statuses a subscription never leaves. */
const ENDED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "canceled",
  "incomplete_expired",
]);

const stripeObjectId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/** The subscription as Stripe bills it now; period dates are on its items. */
function retrieveSubscription(id: string) {
  return stripe.subscriptions.retrieve(id, { expand: ["items.data"] });
}

/**
 * Whether the billing service bills the store now, so its Stripe status is read
 * strictly (rowStatus). A store that no longer exists reads as legacy.
 */
async function serviceBillsNow(storeId: string): Promise<boolean> {
  return !(await legacyBillingAppliesAt(db, storeId, new Date()));
}

/**
 * `checkout.session.completed` of a plan checkout: the row holds the plan and its Stripe
 * ids. The plan is the one the subscription's price bills now, not the one the session
 * sold, which is older once the plan has changed in place; the plan sold is written only
 * for a price no plan has. A session whose subscription has ended since changes nothing:
 * the row may already hold the store's next subscription.
 */
export async function handleSubscriptionCheckoutCompleted(
  session: SubscriptionCheckoutSession,
): Promise<void> {
  const { storeId, planSlug: soldPlanSlug } = session.metadata || {};
  const subscriptionId = stripeObjectId(session.subscription);
  const customerId = stripeObjectId(session.customer);
  if (!storeId || !subscriptionId || !customerId) {
    log.error("billing", "plan checkout session without its store, subscription or customer");
    return;
  }

  const stripeSubscription = await retrieveSubscription(subscriptionId);
  if (ENDED_STATUSES.has(stripeSubscription.status)) {
    log.warn(
      "billing",
      `plan checkout of store ${storeId}: subscription ${subscriptionId} is ${stripeSubscription.status}, so its row is left as it is`,
    );
    return;
  }
  const firstItem = stripeSubscription.items.data[0];
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000);
  const billed = findPlanPrice(getPlans(), firstItem.price.id);
  const planSlug = billed?.plan.slug ?? soldPlanSlug;
  if (!billed) {
    log.error(
      "billing",
      `plan checkout of store ${storeId}: subscription ${subscriptionId} bills price ${firstItem.price.id}, which no plan has: ${planSlug ? `the plan sold, ${planSlug}, is written` : "the session names no plan either"}`,
    );
  }
  if (!planSlug) return;

  await activatePlanSubscription({
    storeId,
    planSlug,
    stripeSubscriptionId: stripeSubscription.id,
    stripeCustomerId: customerId,
    status: rowStatus(stripeSubscription.status, await serviceBillsNow(storeId)),
    currentPeriodEnd,
  });

  // Platform admin notification
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { id: true, name: true, slug: true },
  });
  if (store) {
    const interval =
      billed?.interval ?? (session.metadata?.interval === "yearly" ? "yearly" : "monthly");
    notifySubscriptionActivated(
      { id: store.id, name: store.name, slug: store.slug },
      planSlug,
      interval,
    ).catch(() => {});
  }

  log.info("billing", `subscription created/updated for store ${storeId} with plan ${planSlug}`);
}

/**
 * `customer.subscription.updated`: the status, period and cancellation of the store's
 * row, and its plan, read from the price of the subscription's item, so a plan changed
 * in place or in Stripe's portal gets its own limits. All of it as Stripe bills it when
 * the event is handled, whatever the event carried. A price no plan has leaves the plan
 * as it is.
 */
export async function handleSubscriptionUpdated(event: SubscriptionRef): Promise<void> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, event.id),
    columns: { id: true, storeId: true },
  });

  if (!subscription) {
    log.error("billing", `subscription not found: ${event.id}`);
    return;
  }

  const stripeSubscription = await retrieveSubscription(event.id);
  const status = rowStatus(stripeSubscription.status, await serviceBillsNow(subscription.storeId));

  const firstItem = stripeSubscription.items.data[0];
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000);
  const billed = findPlanPrice(getPlans(), firstItem.price.id);
  if (!billed) {
    log.error(
      "billing",
      `subscription ${stripeSubscription.id} of store ${subscription.storeId} bills price ${firstItem.price.id}, which no plan has: its plan is left as it is`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        ...(billed ? { planSlug: billed.plan.slug } : {}),
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id));
    await markSubscriptionRow(tx, subscription.storeId);
  });

  log.info(
    "billing",
    `subscription updated: ${stripeSubscription.id} -> ${status}${billed ? `, ${billed.plan.slug} ${billed.interval}` : ""}`,
  );
}

/**
 * `customer.subscription.deleted`: the store goes back to pay-as-you-go. The free tier
 * no longer exists, so any ended subscription (whether the owner scheduled a switch to
 * pay-as-you-go, or it simply lapsed or was cancelled) falls back to pay-as-you-go at
 * the pricing already stored on the store's row.
 */
export async function handleSubscriptionDeleted(
  stripeSubscription: SubscriptionRef & { readonly metadata: Stripe.Metadata | null },
): Promise<void> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
    columns: { id: true, storeId: true },
  });

  if (!subscription) {
    log.error("billing", `subscription not found: ${stripeSubscription.id}`);
    return;
  }

  const scheduledPaygSwitch = stripeSubscription.metadata?.pendingBillingMode === "pay_as_you_go";

  await endSubscriptionToPayAsYouGo(subscription.id);

  // Platform admin notification
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, subscription.storeId),
    columns: { id: true, name: true, slug: true },
  });
  if (store) {
    notifySubscriptionCancelled({ id: store.id, name: store.name, slug: store.slug }).catch(
      () => {},
    );
  }

  log.info(
    "billing",
    `subscription ended: ${stripeSubscription.id} → pay-as-you-go${scheduledPaygSwitch ? " (owner-scheduled)" : " (lapsed/cancelled)"}`,
  );
}

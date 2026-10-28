import type Stripe from 'stripe'

import { eq } from 'drizzle-orm'

import { db, legacyBillingAppliesAt, markSubscriptionRow, stores, subscriptions } from '@louez/db'

import {
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
} from '@/lib/discord/platform-notifications'
import { log } from '@/lib/evlog'
import { stripe } from '@/lib/stripe/client'
import { rowStatus } from '@/lib/stripe/subscription-status'
import { activatePlanSubscription, endSubscriptionToPayAsYouGo } from '@/lib/stripe/subscriptions'

// The platform webhook's plan events (app/api/webhooks/stripe/route.ts): a plan bought
// through Checkout, a subscription Stripe updated, and its end. Each row write marks
// the store's snapshots (markSubscriptionRow).

/** What the handlers read of a Stripe subscription. */
export type SubscriptionEventObject = {
  readonly id: string
  readonly status: Stripe.Subscription.Status
  readonly cancel_at_period_end: boolean
  readonly metadata: Stripe.Metadata | null
  readonly items: {
    readonly data: ReadonlyArray<{
      readonly current_period_end: number
      readonly price: { readonly id: string }
    }>
  }
}

/** What the checkout handler reads of a completed Checkout Session in subscription mode. */
export type SubscriptionCheckoutSession = {
  readonly metadata: Stripe.Metadata | null
  readonly subscription: string | { readonly id: string } | null
  readonly customer: string | { readonly id: string } | null
}

const stripeObjectId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null)

/**
 * Whether the billing service bills the store now, so its Stripe status is read
 * strictly (rowStatus). A store that no longer exists reads as legacy.
 */
async function serviceBillsNow(storeId: string): Promise<boolean> {
  return !(await legacyBillingAppliesAt(db, storeId, new Date()))
}

/** `checkout.session.completed` of a plan checkout: the row holds the plan and its Stripe ids. */
export async function handleSubscriptionCheckoutCompleted(
  session: SubscriptionCheckoutSession,
): Promise<void> {
  const { storeId, planSlug } = session.metadata || {}
  const subscriptionId = stripeObjectId(session.subscription)
  const customerId = stripeObjectId(session.customer)
  if (!storeId || !planSlug || !subscriptionId || !customerId) {
    log.error('billing', 'plan checkout session without its store, plan, subscription or customer')
    return
  }

  // The subscription as it is now; period dates are on its items.
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data'],
  })
  const firstItem = stripeSubscription.items.data[0]
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000)

  await activatePlanSubscription({
    storeId,
    planSlug,
    stripeSubscriptionId: stripeSubscription.id,
    stripeCustomerId: customerId,
    status: rowStatus(stripeSubscription.status, await serviceBillsNow(storeId)),
    currentPeriodEnd,
  })

  // Platform admin notification
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { id: true, name: true, slug: true },
  })
  if (store) {
    const interval = session.metadata?.interval === 'yearly' ? 'yearly' : 'monthly'
    notifySubscriptionActivated(
      { id: store.id, name: store.name, slug: store.slug },
      planSlug,
      interval,
    ).catch(() => {})
  }

  log.info('billing', `subscription created/updated for store ${storeId} with plan ${planSlug}`)
}

/** `customer.subscription.updated`: the status, period and cancellation of the store's row. */
export async function handleSubscriptionUpdated(
  stripeSubscription: SubscriptionEventObject,
): Promise<void> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
    columns: { id: true, storeId: true },
  })

  if (!subscription) {
    log.error('billing', `subscription not found: ${stripeSubscription.id}`)
    return
  }

  const status = rowStatus(stripeSubscription.status, await serviceBillsNow(subscription.storeId))

  // In new Stripe API versions, period dates are on subscription items
  const firstItem = stripeSubscription.items.data[0]
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000)

  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id))
    await markSubscriptionRow(tx, subscription.storeId)
  })

  log.info('billing', `subscription updated: ${stripeSubscription.id} -> ${status}`)
}

/**
 * `customer.subscription.deleted`: the store goes back to pay-as-you-go. The free tier
 * no longer exists, so any ended subscription (whether the owner scheduled a switch to
 * pay-as-you-go, or it simply lapsed or was cancelled) falls back to pay-as-you-go at
 * the pricing already stored on the store's row.
 */
export async function handleSubscriptionDeleted(
  stripeSubscription: Pick<SubscriptionEventObject, 'id' | 'metadata'>,
): Promise<void> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
    columns: { id: true, storeId: true },
  })

  if (!subscription) {
    log.error('billing', `subscription not found: ${stripeSubscription.id}`)
    return
  }

  const scheduledPaygSwitch =
    stripeSubscription.metadata?.pendingBillingMode === 'pay_as_you_go'

  await endSubscriptionToPayAsYouGo(subscription.id)

  // Platform admin notification
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, subscription.storeId),
    columns: { id: true, name: true, slug: true },
  })
  if (store) {
    notifySubscriptionCancelled({ id: store.id, name: store.name, slug: store.slug }).catch(
      () => {},
    )
  }

  log.info(
    'billing',
    `subscription ended: ${stripeSubscription.id} → pay-as-you-go${scheduledPaygSwitch ? ' (owner-scheduled)' : ' (lapsed/cancelled)'}`,
  )
}

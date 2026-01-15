import { stripe } from './client'
import { db } from '@/lib/db'
import { stores, subscriptions, subscriptionPlans, users, storeMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

interface CreateCheckoutSessionOptions {
  storeId: string
  planSlug: string
  interval: 'monthly' | 'yearly'
  successUrl: string
  cancelUrl: string
}

export async function createSubscriptionCheckoutSession({
  storeId,
  planSlug,
  interval,
  successUrl,
  cancelUrl,
}: CreateCheckoutSessionOptions) {
  // Get the store with owner info
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  })

  if (!store) {
    throw new Error('Store not found')
  }

  // Get owner email
  const ownerMember = await db
    .select({ email: users.email })
    .from(storeMembers)
    .innerJoin(users, eq(storeMembers.userId, users.id))
    .where(
      and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, 'owner'))
    )
    .limit(1)
    .then((res) => res[0])

  // Get the plan
  const plan = await db.query.subscriptionPlans.findFirst({
    where: eq(subscriptionPlans.slug, planSlug),
  })

  if (!plan) {
    throw new Error('Plan not found')
  }

  // Get or create Stripe customer
  const existingSubscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  let stripeCustomerId = existingSubscription?.stripeCustomerId

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: store.email || ownerMember?.email || undefined,
      name: store.name,
      metadata: {
        storeId: store.id,
        userId: store.userId,
      },
    })
    stripeCustomerId = customer.id
  }

  // Determine the price ID
  const priceId =
    interval === 'monthly' ? plan.stripePriceIdMonthly : plan.stripePriceIdYearly

  if (!priceId) {
    throw new Error('Price not configured for this plan')
  }

  // Create the checkout session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        storeId: store.id,
        planId: plan.id,
        planSlug: plan.slug,
      },
    },
    metadata: {
      storeId: store.id,
      planId: plan.id,
    },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: {
      enabled: true,
    },
  })

  return {
    sessionId: session.id,
    url: session.url,
  }
}

export async function createCustomerPortalSession(storeId: string) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (!subscription?.stripeCustomerId) {
    throw new Error('No subscription found for this store')
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/subscription`,
  })

  return {
    url: session.url,
  }
}

export async function cancelSubscription(storeId: string) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No active subscription found')
  }

  // Cancel at period end
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  })

  // Update DB
  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  return { success: true }
}

export async function reactivateSubscription(storeId: string) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No subscription found')
  }

  // Reactivate
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  })

  // Update DB
  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  return { success: true }
}

export async function getSubscriptionStatus(storeId: string) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    with: {
      plan: true,
    },
  })

  if (!subscription) {
    return {
      status: 'none' as const,
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }
  }

  return {
    status: subscription.status,
    plan: subscription.plan,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
  }
}

export async function syncSubscriptionFromStripe(stripeSubscriptionId: string) {
  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data'],
  })

  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
  })

  if (!subscription) {
    console.error(`Subscription not found: ${stripeSubscriptionId}`)
    return null
  }

  let status: 'active' | 'cancelled' | 'past_due' | 'trialing' = 'active'
  if (stripeSubscription.status === 'past_due') {
    status = 'past_due'
  } else if (stripeSubscription.status === 'canceled') {
    status = 'cancelled'
  } else if (stripeSubscription.status === 'trialing') {
    status = 'trialing'
  }

  // In new Stripe API versions, period dates are on subscription items
  const firstItem = stripeSubscription.items.data[0]
  const currentPeriodStart = new Date(firstItem.current_period_start * 1000)
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000)

  await db
    .update(subscriptions)
    .set({
      status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  return subscription
}

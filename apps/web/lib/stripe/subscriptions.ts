import { stripe } from './client'
import { db, markLegacyStore } from '@louez/db'
import { stores, subscriptions, users, storeMembers } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { getPlan, getPlans, getPlanPriceId, type Plan, type Currency } from '@/lib/plans'
import { BillingDisabledError, isBillingEnabled } from '@/lib/billing/mode'
import { ensureSubscriptionRow } from '@/lib/pay-as-you-go/pricing-lock'
import { env } from '@/env'

// Every write to a subscription row marks the store's legacy_store snapshot for the
// billing service in the same transaction. Stripe calls stay before it.

type SubscriptionColumns = Partial<Omit<typeof subscriptions.$inferInsert, 'id' | 'storeId'>>

/** Updates a store's row, creating it first with the pricing the store already pays. */
async function updateStoreSubscription(storeId: string, values: SubscriptionColumns) {
  await db.transaction(async (tx) => {
    await ensureSubscriptionRow(tx, storeId)
    await tx
      .update(subscriptions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(subscriptions.storeId, storeId))
    await markLegacyStore(tx, storeId)
  })
}

async function updateSubscriptionRow(
  row: { id: string; storeId: string },
  values: SubscriptionColumns,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(subscriptions.id, row.id))
    await markLegacyStore(tx, row.storeId)
  })
}

interface CreateCheckoutSessionOptions {
  storeId: string
  planSlug: string
  interval: 'monthly' | 'yearly'
  currency: Currency
  trialDays?: number
  stripeCouponId?: string
  successUrl: string
  cancelUrl: string
}

/**
 * Get or create a Stripe customer for a store.
 *
 * Looks up the existing Stripe customer ID from the subscriptions table.
 * If none exists, creates a new Stripe customer and immediately persists
 * the ID to prevent duplicate customers on abandoned checkouts.
 *
 * Every platform charge (plan checkout, SMS and AI top-ups, the pay-as-you-go card
 * portal, month-end invoices, referral credits) starts here, so it refuses when platform
 * billing is off: such an instance charges no store and writes no billing rows.
 */
export async function getOrCreateStripeCustomer(storeId: string): Promise<string> {
  if (!isBillingEnabled()) {
    throw new BillingDisabledError('charge a store through the platform Stripe account')
  }
  const existingSubscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (existingSubscription?.stripeCustomerId) {
    return existingSubscription.stripeCustomerId
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: { id: true, name: true, email: true, userId: true },
  })

  if (!store) {
    throw new Error('Store not found')
  }

  const ownerMember = await db
    .select({ email: users.email })
    .from(storeMembers)
    .innerJoin(users, eq(storeMembers.userId, users.id))
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, 'owner')))
    .limit(1)
    .then((res) => res[0])

  const customer = await stripe.customers.create({
    email: store.email || ownerMember?.email || undefined,
    name: store.name,
    metadata: {
      storeId: store.id,
      userId: store.userId,
    },
  })

  // Persist immediately to prevent duplicate customers on retry. A store with no row yet
  // gets one with the pricing it already pays (pay-as-you-go, never the offer for new
  // stores), so saving the customer id never changes what it is charged.
  await updateStoreSubscription(storeId, { stripeCustomerId: customer.id })

  return customer.id
}

export async function createSubscriptionCheckoutSession({
  storeId,
  planSlug,
  interval,
  currency,
  trialDays,
  stripeCouponId,
  successUrl,
  cancelUrl,
}: CreateCheckoutSessionOptions) {
  // Get the plan from code
  const plan = getPlan(planSlug)

  if (!plan) {
    throw new Error('Plan not found')
  }

  // Determine the price ID based on interval and currency
  const priceId = getPlanPriceId(plan, interval, currency)

  if (!priceId) {
    throw new Error(`Price not configured for this plan in ${currency.toUpperCase()}`)
  }

  // Get or create Stripe customer (persisted to DB to avoid duplicates on abandoned checkouts)
  const stripeCustomerId = await getOrCreateStripeCustomer(storeId)
  const hasTrial = Boolean(trialDays && trialDays > 0)

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
        storeId,
        planSlug: plan.slug,
      },
      ...(trialDays && trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    metadata: {
      storeId,
      planSlug: plan.slug,
    },
    // Do not force card collection when trial starts with no immediate amount due.
    payment_method_collection: hasTrial ? 'if_required' : 'always',
    // Allow updating existing customer's info during checkout
    // Required for tax_id_collection when customer already exists
    customer_update: {
      name: 'auto',
      address: 'auto',
    },
    // Apply platform admin discount if configured
    // Note: Stripe doesn't allow both discounts and allow_promotion_codes
    ...(stripeCouponId
      ? { discounts: [{ coupon: stripeCouponId }] }
      : { allow_promotion_codes: true }),
    billing_address_collection: 'required',
    // Automatically calculate and add tax based on customer location
    automatic_tax: {
      enabled: true,
    },
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
    throw new Error('No Stripe customer found for this store')
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/subscription`,
  })

  return {
    url: session.url,
  }
}

export async function hasStripeCustomer(storeId: string): Promise<boolean> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { stripeCustomerId: true },
  })
  return !!subscription?.stripeCustomerId
}

/**
 * Whether the store's platform Stripe customer has a default payment method on file.
 * Read-only (never creates a customer); returns false when there is no customer yet.
 * Used to warn pay-as-you-go stores that their month-end invoice will be sent for
 * manual payment until a card is added.
 */
export async function storeHasDefaultPaymentMethod(storeId: string): Promise<boolean> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { stripeCustomerId: true },
  })
  if (!subscription?.stripeCustomerId) return false

  try {
    const customer = await stripe.customers.retrieve(subscription.stripeCustomerId)
    if (customer.deleted) return false
    return Boolean(customer.invoice_settings?.default_payment_method || customer.default_source)
  } catch (error) {
    console.error('Failed to check default payment method:', error)
    return false
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
  await updateSubscriptionRow(subscription, { cancelAtPeriodEnd: true })

  return { success: true }
}

export async function reactivateSubscription(storeId: string) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (!subscription?.stripeSubscriptionId) {
    throw new Error('No subscription found')
  }

  // Reactivate and clear any pending switch-to-PAYG flag (merge-safe metadata write).
  const current = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
  const metadata = { ...current.metadata }
  delete metadata.pendingBillingMode
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
    metadata: { ...metadata, pendingBillingMode: '' },
  })

  // Update DB
  await updateSubscriptionRow(subscription, { cancelAtPeriodEnd: false })

  return { success: true }
}

export type SwitchToPayAsYouGoResult =
  | { mode: 'immediate' }
  | { mode: 'deferred'; effectiveAt: Date | null }

/**
 * Owner-initiated switch to pay-as-you-go.
 * - With no active Stripe subscription (already PAYG / uninitialized): flips immediately.
 * - On a paid plan: schedules cancellation at period end and tags the Stripe
 *   subscription so the deletion webhook flips the mode then — no double billing.
 */
export async function switchToPayAsYouGo(storeId: string): Promise<SwitchToPayAsYouGoResult> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  // Active paid subscription → defer to period end.
  if (subscription?.stripeSubscriptionId) {
    const current = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
      metadata: { ...current.metadata, pendingBillingMode: 'pay_as_you_go' },
    })
    await updateSubscriptionRow(subscription, { cancelAtPeriodEnd: true })
    return {
      mode: 'deferred',
      effectiveAt: subscription.currentPeriodEnd ?? null,
    }
  }

  // No active Stripe subscription (or no row yet) → switch immediately. Set planSlug
  // alongside billingMode so the row never carries a stale paid-plan slug with PAYG mode.
  // Only the mode changes: the store keeps the pricing stored on its row.
  await updateStoreSubscription(storeId, {
    planSlug: 'pay_as_you_go',
    billingMode: 'pay_as_you_go',
  })
  return { mode: 'immediate' }
}

/**
 * Record a paid plan bought through Stripe Checkout. Subscribing always lands the store on
 * subscription billing (covers an owner switching from pay-as-you-go). Only plan, mode and
 * Stripe columns change: the store keeps its pay-as-you-go pricing for when the
 * subscription ends, and with platform billing on a store without a row gets one with the
 * pricing it already pays.
 */
export async function activatePlanSubscription(input: {
  storeId: string
  planSlug: string
  stripeSubscriptionId: string
  stripeCustomerId: string
  status: 'active' | 'trialing'
  currentPeriodEnd: Date
}) {
  await updateStoreSubscription(input.storeId, {
    planSlug: input.planSlug,
    billingMode: 'subscription',
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeCustomerId: input.stripeCustomerId,
    status: input.status,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelAtPeriodEnd: false,
  })
}

/**
 * Return a store to pay-as-you-go when its Stripe subscription ended (owner-scheduled
 * switch or lapse). The free tier no longer exists, so the store keeps working with no
 * monthly fee and is billed per rental at the pricing already stored on its row: only
 * plan, mode, status and Stripe columns change.
 */
export async function endSubscriptionToPayAsYouGo(subscriptionRowId: string) {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionRowId),
    columns: { id: true, storeId: true },
  })
  if (!row) return
  await updateSubscriptionRow(row, {
    planSlug: 'pay_as_you_go',
    billingMode: 'pay_as_you_go',
    status: 'active',
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  })
}

export async function getSubscriptionWithPlan(storeId: string) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (!subscription) {
    return null
  }

  // Get plan from code
  const plan = getPlan(subscription.planSlug)

  // Get billing interval and currency from Stripe if subscription exists
  let billingInterval: 'monthly' | 'yearly' | null = null
  let billingCurrency: Currency | null = null
  // 'pay_as_you_go' when the owner scheduled a switch that takes effect at period end.
  let pendingBillingMode: string | null = null
  if (subscription.stripeSubscriptionId) {
    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId,
        { expand: ['items.data'] },
      )
      pendingBillingMode = stripeSubscription.metadata?.pendingBillingMode || null
      const firstItem = stripeSubscription.items.data[0]
      if (firstItem?.price?.recurring?.interval === 'year') {
        billingInterval = 'yearly'
      } else if (firstItem?.price?.recurring?.interval === 'month') {
        billingInterval = 'monthly'
      }
      // Get the actual currency used for this subscription
      if (firstItem?.price?.currency) {
        const currency = firstItem.price.currency.toLowerCase()
        if (currency === 'eur' || currency === 'usd') {
          billingCurrency = currency as Currency
        }
      }
    } catch (error) {
      console.error('Error fetching Stripe subscription:', error)
    }
  }

  return {
    ...subscription,
    plan,
    billingInterval,
    billingCurrency,
    pendingBillingMode,
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
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000)

  await updateSubscriptionRow(subscription, {
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
  })

  return subscription
}

/**
 * Get the current plan slug for a store (lightweight version for sidebar)
 */
export async function getCurrentPlanSlug(storeId: string): Promise<string> {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { planSlug: true, status: true, billingMode: true },
  })

  // No subscription, PAYG mode, or a cancelled paid plan all resolve to pay-as-you-go
  // (the free tier no longer exists).
  if (!subscription || subscription.billingMode === 'pay_as_you_go') {
    return 'pay_as_you_go'
  }

  if (subscription.status === 'cancelled') {
    return 'pay_as_you_go'
  }

  return subscription.planSlug
}

export { getPlans, getPlan, type Plan }

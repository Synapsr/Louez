import { after } from 'next/server'
import { stripe } from './client'
import { db, markSubscriptionRow } from '@louez/db'
import { stores, subscriptions, users, storeMembers } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { getPlan, getPlans, getPlanPriceId, type Plan, type Currency } from '@/lib/plans'
import { BillingDisabledError, isBillingEnabled } from '@/lib/billing/mode'
import { getEffectivePolicy } from '@/lib/billing/policy'
import { type BillingAlerts, createBillingAlerts } from '@/lib/billing-sync/alerts'
import { isStripeNotFound } from '@/lib/billing-sync/gross-backfill-core'
import { log } from '@/lib/evlog'
import { ensurePlanRow } from '@/lib/pay-as-you-go/pricing-lock'
import {
  hasLiveSubscription,
  subscriptionEnded,
  type SubscriptionRowStatus,
} from '@/lib/stripe/subscription-status'
import { env } from '@/env'

// Every write to a subscription row marks the store's store and legacy_store snapshots
// for the billing service in the same transaction (markSubscriptionRow). Stripe calls
// stay before it.

type SubscriptionColumns = Partial<Omit<typeof subscriptions.$inferInsert, 'id' | 'storeId'>>

/**
 * Updates a store's row, creating it first (ensurePlanRow): with the pricing the store
 * already pays when Louez's legacy code bills it at `at`, with no pricing when the
 * billing service does.
 */
async function updateStoreSubscription(
  storeId: string,
  values: SubscriptionColumns,
  at: Date = new Date(),
) {
  await db.transaction(async (tx) => {
    await ensurePlanRow(tx, storeId, at)
    await tx
      .update(subscriptions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(subscriptions.storeId, storeId))
    await markSubscriptionRow(tx, storeId)
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
    await markSubscriptionRow(tx, row.storeId)
  })
}

/** Why a plan checkout or a plan change cannot go on: the actions answer `errors.unsupportedOperation`. */
export type SubscriptionPlanRefusal =
  /** A checkout while the row holds a live subscription: change its plan instead. */
  | 'live_subscription'
  /** A plan change without a live subscription to change. */
  | 'no_live_subscription'
  /** A subscription with more or fewer than one item: Louez never makes one. */
  | 'subscription_items'
  /** Stripe cannot move a subscription to another currency. */
  | 'currency'

export class SubscriptionPlanError extends Error {
  readonly reason: SubscriptionPlanRefusal

  constructor(reason: SubscriptionPlanRefusal) {
    super(`Plan change refused: ${reason}`)
    this.name = 'SubscriptionPlanError'
    this.reason = reason
  }
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
 * The store's customer on the platform Stripe account for a charge at `at`, read
 * without creating one (louez-billing docs/api, README §8.4). For a store the billing
 * service bills at `at`, only the service holds one: the policy's `stripeCustomerId`,
 * null until the owner adds a card on the billing pages. For a store legacy at `at`,
 * the policy's customer once the service has adopted it, otherwise the one Louez
 * created (`subscriptions`). Null with LOUEZ_BILLING off, without a read.
 */
async function findPlatformCustomer(
  storeId: string,
  at: Date,
): Promise<{ readonly customerId: string | null; readonly legacy: boolean }> {
  const effective = await getEffectivePolicy(storeId, at)
  const fromPolicy = effective.policy?.stripeCustomerId ?? null
  if (!effective.legacyBillingApplies || fromPolicy) {
    return { customerId: fromPolicy, legacy: effective.legacyBillingApplies }
  }
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { stripeCustomerId: true },
  })
  return { customerId: row?.stripeCustomerId ?? null, legacy: true }
}

/**
 * Creates a store's platform customer, as Louez always has (`metadata.storeId`), and
 * saves its id on the store's row at once, so an abandoned checkout or a retry never
 * creates a second one. For a store legacy at `at`, and for the plan checkout of a store
 * the billing service bills that holds no customer yet (README §8.4). A store with no
 * row yet gets the one ensurePlanRow gives it, so saving the id never changes what it
 * is charged.
 */
async function createPlatformCustomer(storeId: string, at: Date): Promise<string> {
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

  await updateStoreSubscription(storeId, { stripeCustomerId: customer.id }, at)

  return customer.id
}

/**
 * The store's platform customer for a charge at `at` (findPlatformCustomer), created
 * when a store legacy at `at` has none. Refuses when platform billing is off: such an
 * instance charges no store and writes no billing rows.
 */
async function resolvePlatformCustomer(
  storeId: string,
  at: Date,
): Promise<{ readonly customerId: string | null; readonly legacy: boolean }> {
  if (!isBillingEnabled()) {
    throw new BillingDisabledError('charge a store through the platform Stripe account')
  }
  const found = await findPlatformCustomer(storeId, at)
  if (found.customerId || !found.legacy) return found
  return { customerId: await createPlatformCustomer(storeId, at), legacy: true }
}

/**
 * The store's platform customer for a charge now: SMS and AI top-ups, the
 * pay-as-you-go card portal (louez-billing docs/api, README §8.4).
 *
 * A legacy store keeps the customer Louez created, and gets one when it has none, as
 * before, until B. For a store the billing service bills, Louez never creates one:
 * null until the service has one. The caller then starts no charge and sends the owner
 * to the billing pages to add a card (`/payment-method`, Q39).
 */
export async function getPlatformCustomerId(storeId: string): Promise<string | null> {
  return (await resolvePlatformCustomer(storeId, new Date())).customerId
}

/**
 * The platform customer a charge of Louez's own billing for a fact at `at` goes to:
 * the month-end invoice, at the end of its month as the run chose the store, a legacy
 * store's plan checkout, a referral credit. Throws for a store Louez's legacy code
 * does not bill at `at`. A store legacy at `at` keeps its customer of then, and gets
 * one when it has none, also once the billing service bills it: Louez still invoices
 * its last legacy month (README §8.3, §8.4).
 */
export async function getLegacyPlatformCustomerId(
  storeId: string,
  at: Date = new Date(),
): Promise<string> {
  const { customerId, legacy } = await resolvePlatformCustomer(storeId, at)
  if (!legacy || !customerId) {
    throw new Error(
      `Store ${storeId} is billed by the billing service at ${at.toISOString()}: no Louez platform charge`,
    )
  }
  return customerId
}

/**
 * The platform customer a store's plan checkout bills (louez-billing docs/api, README
 * §8.4, Q46). A store legacy now keeps Louez's own (getLegacyPlatformCustomerId). A
 * store the billing service bills takes the policy's customer, else the one on its
 * row, else one Louez creates and keeps on its row. Top-ups never use this: they take
 * the policy's customer only (getPlatformCustomerId).
 */
export async function getPlanCustomerId(storeId: string): Promise<string> {
  if (!isBillingEnabled()) {
    throw new BillingDisabledError('charge a store through the platform Stripe account')
  }
  const now = new Date()
  const effective = await getEffectivePolicy(storeId, now)
  if (effective.legacyBillingApplies) return getLegacyPlatformCustomerId(storeId, now)
  const fromPolicy = effective.policy?.stripeCustomerId
  if (fromPolicy) return fromPolicy
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { stripeCustomerId: true },
  })
  return row?.stripeCustomerId || createPlatformCustomer(storeId, now)
}

/** The parts of a retrieved Stripe customer the off-session check reads. */
export type RetrievedPlatformCustomer = {
  readonly id: string
  readonly deleted?: unknown
  readonly metadata?: Readonly<Record<string, string>> | null
  readonly invoice_settings?: { readonly default_payment_method?: unknown } | null
  readonly default_source?: unknown
}

export type OffSessionCustomer =
  | { readonly ok: true; readonly customerId: string }
  | {
      readonly ok: false
      readonly reason:
        | 'no_customer'
        | 'unavailable'
        | 'deleted'
        | 'other_store'
        | 'no_payment_method'
    }

/**
 * The store a platform customer belongs to: `metadata.billing_store_id`, which the
 * billing service sets, otherwise the `metadata.storeId` Louez sets (README §8.4, §9).
 */
export function platformCustomerStoreId(customer: RetrievedPlatformCustomer): string | null {
  return customer.metadata?.billing_store_id || customer.metadata?.storeId || null
}

/** Whether an off-session charge of `storeId` may use this customer (README §8.4). */
export function checkOffSessionCustomer(
  customer: RetrievedPlatformCustomer,
  storeId: string,
): OffSessionCustomer {
  if (customer.deleted === true) return { ok: false, reason: 'deleted' }
  if (platformCustomerStoreId(customer) !== storeId) return { ok: false, reason: 'other_store' }
  const hasPaymentMethod = Boolean(
    customer.invoice_settings?.default_payment_method || customer.default_source,
  )
  if (!hasPaymentMethod) return { ok: false, reason: 'no_payment_method' }
  return { ok: true, customerId: customer.id }
}

export type OffSessionCustomerOptions = {
  readonly alerts?: BillingAlerts
  readonly retrieveCustomer?: (customerId: string) => Promise<RetrievedPlatformCustomer>
}

/**
 * The customer an off-session charge (the AI auto top-up) may use: the store's platform
 * customer, never a new one, retrieved from Stripe, not deleted, with a default payment
 * method, and whose metadata names this store (README §8.4). A customer that names
 * another store is refused with an alert. The request handlers that charge wait for
 * this answer, so the alert's Discord part runs after theirs (`after`).
 */
export async function getOffSessionCustomer(
  storeId: string,
  options: OffSessionCustomerOptions = {},
): Promise<OffSessionCustomer> {
  const alerts = options.alerts ?? createBillingAlerts({ schedule: after })
  const retrieveCustomer =
    options.retrieveCustomer ?? ((customerId: string) => stripe.customers.retrieve(customerId))
  const { customerId } = await findPlatformCustomer(storeId, new Date())
  if (!customerId) return { ok: false, reason: 'no_customer' }
  let customer: RetrievedPlatformCustomer
  try {
    customer = await retrieveCustomer(customerId)
  } catch (error) {
    log.error(
      'billing',
      `could not retrieve platform customer ${customerId} of store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { ok: false, reason: 'unavailable' }
  }
  const checked = checkOffSessionCustomer(customer, storeId)
  if (!checked.ok && checked.reason === 'other_store') {
    await alerts.alert(
      'platform_customer_mismatch',
      `platform customer ${customerId} of store ${storeId} names store ${platformCustomerStoreId(customer) ?? 'none'} in its metadata: off-session charge refused`,
    )
  }
  return checked
}

/**
 * The subscription a row holds, as Stripe has it now: read before a plan checkout is
 * refused or a plan changes in place. One Stripe has ended (canceled,
 * incomplete_expired) or no longer has means the webhook missed its `.deleted`: the row
 * ends as that handler ends it (endSubscriptionToPayAsYouGo), so the store is back on
 * pay-as-you-go with both marks, and the answer is null.
 */
async function currentHeldSubscription(row: {
  readonly id: string
  readonly storeId: string
  readonly stripeSubscriptionId: string
}) {
  const current = await stripe.subscriptions
    .retrieve(row.stripeSubscriptionId)
    .catch((error: unknown) => {
      if (isStripeNotFound(error)) return null
      throw error
    })
  if (current && !subscriptionEnded(current.status)) return current
  log.warn(
    'billing',
    `store ${row.storeId}: its row holds subscription ${row.stripeSubscriptionId}, which Stripe ${current ? `has ${current.status}` : 'no longer has'}, so the row goes back to pay-as-you-go`,
  )
  await endSubscriptionToPayAsYouGo(row.id, row.stripeSubscriptionId)
  return null
}

/**
 * How long a plan Checkout stays payable. Stripe's minimum is 30 minutes after it
 * creates the session; the extra minute covers the request and the clocks' drift.
 */
const PLAN_CHECKOUT_LIFETIME_SECONDS = 31 * 60

/**
 * Expires the plan Checkouts the store left open on its customer, before it opens
 * another: each one paid would start a plan subscription of its own. A Checkout that
 * cannot be listed or expired is logged and does not stop the new one; the checkout
 * webhook then keeps the subscription the row holds (handleSubscriptionCheckoutCompleted).
 */
async function expireOpenPlanCheckouts(storeId: string, customerId: string): Promise<void> {
  const open = await stripe.checkout.sessions
    .list({ customer: customerId, status: 'open', limit: 100 })
    .then((listed) => listed.data)
    .catch((error: unknown) => {
      log.error(
        'billing',
        `could not list the open Checkouts of customer ${customerId} of store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return []
    })
  for (const session of open) {
    if (session.mode !== 'subscription' || session.metadata?.storeId !== storeId) continue
    try {
      await stripe.checkout.sessions.expire(session.id)
    } catch (error) {
      log.error(
        'billing',
        `could not expire plan Checkout ${session.id} of store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
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
  // Louez bills plans to every store, new ones included (README §8.7), on cloud only.
  if (!isBillingEnabled()) {
    throw new BillingDisabledError('sell a plan through the platform Stripe account')
  }

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

  // One live plan subscription per store: a second Checkout would leave the first one
  // billing. The plan page changes the live one in place (changeSubscriptionPlan). One
  // Stripe has ended no longer counts (currentHeldSubscription).
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { id: true, storeId: true, status: true, stripeSubscriptionId: true },
  })
  if (hasLiveSubscription(row) && (await currentHeldSubscription(row))) {
    throw new SubscriptionPlanError('live_subscription')
  }

  // Persisted to the DB at creation, to avoid duplicates on abandoned checkouts.
  const stripeCustomerId = await getPlanCustomerId(storeId)
  const hasTrial = Boolean(trialDays && trialDays > 0)

  // One open plan Checkout per store, payable for a short while only.
  await expireOpenPlanCheckouts(storeId, stripeCustomerId)
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    expires_at: Math.floor(Date.now() / 1000) + PLAN_CHECKOUT_LIFETIME_SECONDS,
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

/**
 * What a plan change did: `in_place` on the live subscription, or `subscription_ended`
 * when Stripe had ended the row's subscription. The row is then on pay-as-you-go, and
 * the plan is bought through Checkout.
 */
export type PlanChangeOutcome = 'in_place' | 'subscription_ended'

/**
 * Moves the store's live plan subscription to another plan or interval on the same
 * Stripe subscription, for every store (plans-for-new-stores decision 5): its one item
 * gets the plan's price, prorated, at once. A cancellation the owner scheduled is
 * lifted, as buying the new plan would have done. Stripe's `customer.subscription.updated`
 * writes the plan from the price too (handleSubscriptionUpdated); the row gets it now,
 * so the page shows it. A subscription Stripe has ended changes nothing in Stripe and
 * ends the row (currentHeldSubscription).
 */
export async function changeSubscriptionPlan(
  storeId: string,
  planSlug: string,
  interval: 'monthly' | 'yearly',
  currency: Currency,
): Promise<PlanChangeOutcome> {
  if (!isBillingEnabled()) {
    throw new BillingDisabledError('change a plan on the platform Stripe account')
  }
  const plan = getPlan(planSlug)
  if (!plan) {
    throw new Error('Plan not found')
  }
  const priceId = getPlanPriceId(plan, interval, currency)
  if (!priceId) {
    throw new Error(`Price not configured for this plan in ${currency.toUpperCase()}`)
  }

  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
    columns: { id: true, storeId: true, status: true, stripeSubscriptionId: true },
  })
  if (!hasLiveSubscription(row)) {
    throw new SubscriptionPlanError('no_live_subscription')
  }

  const current = await currentHeldSubscription(row)
  if (!current) return 'subscription_ended'
  const [item, ...others] = current.items.data
  if (!item || others.length > 0) {
    throw new SubscriptionPlanError('subscription_items')
  }
  if (item.price.currency.toLowerCase() !== currency) {
    throw new SubscriptionPlanError('currency')
  }
  if (item.price.id === priceId && !current.cancel_at_period_end) return 'in_place'

  await stripe.subscriptions.update(current.id, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: 'create_prorations',
    cancel_at_period_end: false,
    metadata: { planSlug: plan.slug, pendingBillingMode: '' },
  })
  await updateSubscriptionRow(row, { planSlug: plan.slug, cancelAtPeriodEnd: false })
  return 'in_place'
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
  const { customerId } = await findPlatformCustomer(storeId, new Date())
  return customerId !== null
}

/**
 * Whether the store's platform Stripe customer has a default payment method on file.
 * Read-only (never creates a customer); returns false when there is no customer yet.
 * Used to warn pay-as-you-go stores that their month-end invoice will be sent for
 * manual payment until a card is added.
 */
export async function storeHasDefaultPaymentMethod(storeId: string): Promise<boolean> {
  const { customerId } = await findPlatformCustomer(storeId, new Date())
  if (!customerId) return false

  try {
    const customer = await stripe.customers.retrieve(customerId)
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
  /** rowStatus of the subscription's Stripe status. */
  status: SubscriptionRowStatus
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
 * plan, mode, status and Stripe columns change. With `stripeSubscriptionId`, only while
 * the row still holds that subscription.
 */
export async function endSubscriptionToPayAsYouGo(
  subscriptionRowId: string,
  stripeSubscriptionId?: string,
) {
  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.id, subscriptionRowId),
      stripeSubscriptionId === undefined
        ? undefined
        : eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
    ),
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

/**
 * Get the current plan slug for a store (lightweight version for sidebar)
 */
export async function getCurrentPlanSlug(storeId: string): Promise<string> {
  // Without platform billing every store is on the unlimited plan (see getStorePlan).
  if (!isBillingEnabled()) return 'pay_as_you_go'

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

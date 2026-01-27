import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { db } from '@/lib/db'
import { subscriptions, smsCredits, smsTopupTransactions, stores } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
  notifySmsCreditsTopup,
} from '@/lib/discord/platform-notifications'

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook handler error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const { type } = session.metadata || {}

  // Handle SMS top-up payment
  if (type === 'sms_topup' && session.mode === 'payment') {
    await handleSmsTopupCompleted(session)
    return
  }

  // Handle subscription payment
  if (session.mode !== 'subscription') return

  const { storeId, planSlug } = session.metadata || {}
  if (!storeId || !planSlug) {
    console.error('Missing metadata in checkout session')
    return
  }

  // Get Stripe subscription details (expand items to get period dates)
  const stripeSubscription = await stripe.subscriptions.retrieve(
    session.subscription as string,
    { expand: ['items.data'] }
  )

  // In new Stripe API versions, period dates are on subscription items
  const firstItem = stripeSubscription.items.data[0]
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000)

  // Determine status from Stripe (may be 'trialing' if trial days were set)
  const status: 'active' | 'trialing' =
    stripeSubscription.status === 'trialing' ? 'trialing' : 'active'

  // Check if subscription already exists
  const existingSubscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (existingSubscription) {
    // Update existing subscription
    await db
      .update(subscriptions)
      .set({
        planSlug,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId: session.customer as string,
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existingSubscription.id))
  } else {
    // Create new subscription
    await db.insert(subscriptions).values({
      id: nanoid(),
      storeId,
      planSlug,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: session.customer as string,
      status,
      currentPeriodEnd,
    })
  }

  // Platform admin notification
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (store) {
    const interval = (session.metadata?.interval as 'monthly' | 'yearly') || 'monthly'
    notifySubscriptionActivated(
      { id: store.id, name: store.name, slug: store.slug },
      planSlug,
      interval
    ).catch(() => {})
  }

  console.log(`Subscription created/updated for store ${storeId} with plan ${planSlug}`)
}

/**
 * Handle SMS top-up payment completion
 * Credits the store with purchased SMS credits
 */
async function handleSmsTopupCompleted(session: Stripe.Checkout.Session) {
  const { storeId, transactionId, quantity } = session.metadata || {}

  if (!storeId || !transactionId || !quantity) {
    console.error('Missing metadata in SMS top-up checkout session')
    return
  }

  const qty = parseInt(quantity, 10)
  if (isNaN(qty) || qty <= 0) {
    console.error('Invalid quantity in SMS top-up checkout session')
    return
  }

  // Check if transaction exists and is pending
  const transaction = await db.query.smsTopupTransactions.findFirst({
    where: eq(smsTopupTransactions.id, transactionId),
  })

  if (!transaction) {
    console.error(`SMS top-up transaction not found: ${transactionId}`)
    return
  }

  if (transaction.status !== 'pending') {
    console.log(`SMS top-up transaction already processed: ${transactionId}`)
    return
  }

  // Use a transaction to ensure atomicity
  await db.transaction(async (tx) => {
    // Check if smsCredits record exists for this store
    const existingCredits = await tx.query.smsCredits.findFirst({
      where: eq(smsCredits.storeId, storeId),
    })

    if (existingCredits) {
      // Update existing credits
      await tx
        .update(smsCredits)
        .set({
          balance: sql`${smsCredits.balance} + ${qty}`,
          totalPurchased: sql`${smsCredits.totalPurchased} + ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(smsCredits.storeId, storeId))
    } else {
      // Create new credits record
      await tx.insert(smsCredits).values({
        id: nanoid(),
        storeId,
        balance: qty,
        totalPurchased: qty,
        totalUsed: 0,
      })
    }

    // Update transaction status
    await tx
      .update(smsTopupTransactions)
      .set({
        status: 'completed',
        stripePaymentIntentId: session.payment_intent as string,
        completedAt: new Date(),
      })
      .where(eq(smsTopupTransactions.id, transactionId))
  })

  // Platform admin notification
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (store) {
    notifySmsCreditsTopup({ id: store.id, name: store.name, slug: store.slug }, qty).catch(() => {})
  }

  console.log(`SMS top-up completed for store ${storeId}: ${qty} credits added`)
}

async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
  })

  if (!subscription) {
    console.error(`Subscription not found: ${stripeSubscription.id}`)
    return
  }

  // Determine new status
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

  await db
    .update(subscriptions)
    .set({
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  console.log(`Subscription updated: ${stripeSubscription.id} -> ${status}`)
}

async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
  })

  if (!subscription) {
    console.error(`Subscription not found: ${stripeSubscription.id}`)
    return
  }

  // Reset to free plan instead of deleting
  await db
    .update(subscriptions)
    .set({
      planSlug: 'start',
      status: 'cancelled',
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  // Platform admin notification
  const store = await db.query.stores.findFirst({ where: eq(stores.id, subscription.storeId) })
  if (store) {
    notifySubscriptionCancelled({ id: store.id, name: store.name, slug: store.slug }).catch(() => {})
  }

  console.log(`Subscription cancelled: ${stripeSubscription.id}`)
}

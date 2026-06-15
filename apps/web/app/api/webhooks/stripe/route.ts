import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { db } from '@louez/db'
import { subscriptions, smsCredits, smsTopupTransactions, stores } from '@louez/db'
import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
  notifySmsCreditsTopup,
} from '@/lib/discord/platform-notifications'
import { reconcilePayAsYouGoInvoice } from '@/lib/pay-as-you-go'
import { env } from '@/env'

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET)
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

      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handlePayAsYouGoInvoiceEvent(
          event.data.object as Stripe.Invoice,
          'paid',
        )
        break

      case 'invoice.payment_failed':
      case 'invoice.marked_uncollectible':
        await handlePayAsYouGoInvoiceEvent(
          event.data.object as Stripe.Invoice,
          'failed',
        )
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
    // Update existing subscription. Subscribing always lands the store on
    // subscription billing (covers an owner switching from pay-as-you-go).
    await db
      .update(subscriptions)
      .set({
        planSlug,
        billingMode: 'subscription',
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
      billingMode: 'subscription',
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
 * Reconcile a pay-as-you-go month-end invoice when Stripe reports its outcome.
 * Closes the loop for hosted (send_invoice) invoices and for charge_automatically
 * invoices that succeed/fail via dunning after the initial month-end run.
 */
async function handlePayAsYouGoInvoiceEvent(
  invoice: Stripe.Invoice,
  outcome: 'paid' | 'failed',
) {
  if (invoice.metadata?.type !== 'pay_as_you_go' || !invoice.id) return
  await reconcilePayAsYouGoInvoice(invoice.id, outcome)
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

  // If the owner scheduled a switch to pay-as-you-go (cancel at period end), apply it
  // now that the paid period has actually ended — no double billing in between.
  const switchingToPayg =
    stripeSubscription.metadata?.pendingBillingMode === 'pay_as_you_go'

  await db
    .update(subscriptions)
    .set({
      planSlug: 'start',
      billingMode: switchingToPayg ? 'pay_as_you_go' : 'subscription',
      status: switchingToPayg ? 'active' : 'cancelled',
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

  console.log(
    `Subscription ended: ${stripeSubscription.id}${switchingToPayg ? ' → switched to pay-as-you-go' : ''}`,
  )
}

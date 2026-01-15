import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { db } from '@/lib/db'
import { subscriptions, subscriptionPayments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

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

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
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
  if (session.mode !== 'subscription') return

  const { storeId, planId } = session.metadata || {}
  if (!storeId || !planId) {
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
  const currentPeriodStart = new Date(firstItem.current_period_start * 1000)
  const currentPeriodEnd = new Date(firstItem.current_period_end * 1000)

  // Check if subscription already exists
  const existingSubscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })

  if (existingSubscription) {
    // Update existing subscription
    await db
      .update(subscriptions)
      .set({
        planId,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId: session.customer as string,
        status: 'active',
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, existingSubscription.id))
  } else {
    // Create new subscription
    await db.insert(subscriptions).values({
      id: nanoid(),
      storeId,
      planId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: session.customer as string,
      status: 'active',
      currentPeriodStart,
      currentPeriodEnd,
    })
  }

  console.log(`Subscription created/updated for store ${storeId}`)
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

  await db
    .update(subscriptions)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  console.log(`Subscription cancelled: ${stripeSubscription.id}`)
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // In new Stripe API versions, subscription is accessed via parent.subscription_details
  const subscriptionId = invoice.parent?.subscription_details?.subscription
  if (!subscriptionId) return

  const stripeSubId = typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubId),
  })

  if (!subscription) {
    console.error(`Subscription not found for invoice: ${invoice.id}`)
    return
  }

  // Record the payment
  await db.insert(subscriptionPayments).values({
    id: nanoid(),
    subscriptionId: subscription.id,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: null, // Payment intent is nested in new API versions
    stripeChargeId: null, // Charge is nested in new API versions
    amount: (invoice.amount_paid / 100).toFixed(2),
    currency: invoice.currency.toUpperCase(),
    status: 'completed',
    paidAt: invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : new Date(),
    periodStart: new Date(invoice.period_start * 1000),
    periodEnd: new Date(invoice.period_end * 1000),
    invoicePdfUrl: invoice.invoice_pdf ?? null,
  })

  // Update subscription status if it was past_due
  if (subscription.status === 'past_due') {
    await db
      .update(subscriptions)
      .set({
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id))
  }

  console.log(`Invoice paid: ${invoice.id}`)
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  // In new Stripe API versions, subscription is accessed via parent.subscription_details
  const subscriptionId = invoice.parent?.subscription_details?.subscription
  if (!subscriptionId) return

  const stripeSubId = typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubId),
  })

  if (!subscription) return

  // Record the failed payment
  await db.insert(subscriptionPayments).values({
    id: nanoid(),
    subscriptionId: subscription.id,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: null, // Payment intent is nested in new API versions
    amount: (invoice.amount_due / 100).toFixed(2),
    currency: invoice.currency.toUpperCase(),
    status: 'failed',
    periodStart: new Date(invoice.period_start * 1000),
    periodEnd: new Date(invoice.period_end * 1000),
  })

  // Update subscription status
  await db
    .update(subscriptions)
    .set({
      status: 'past_due',
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id))

  console.log(`Invoice payment failed: ${invoice.id}`)
}

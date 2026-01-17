import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { db } from '@/lib/db'
import { payments, reservations, stores, reservationActivity } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { fromStripeCents } from '@/lib/stripe'

/**
 * Webhook handler for Stripe Connect events
 * This handles payment events from connected accounts (rental payments and deposit holds)
 */
export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_CONNECT_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Connect webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Get connected account ID from event
  const connectedAccountId = event.account

  try {
    switch (event.type) {
      // Checkout events
      case 'checkout.session.completed':
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
          connectedAccountId
        )
        break

      case 'checkout.session.expired':
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session)
        break

      // Deposit authorization hold events
      case 'payment_intent.amount_capturable_updated':
        await handleDepositAuthorized(
          event.data.object as Stripe.PaymentIntent,
          connectedAccountId
        )
        break

      case 'payment_intent.canceled':
        await handleDepositReleased(
          event.data.object as Stripe.PaymentIntent,
          connectedAccountId
        )
        break

      case 'payment_intent.succeeded':
        await handleDepositCaptured(
          event.data.object as Stripe.PaymentIntent,
          connectedAccountId
        )
        break

      case 'payment_intent.payment_failed':
        await handleDepositFailed(
          event.data.object as Stripe.PaymentIntent,
          connectedAccountId
        )
        break

      // Refund events
      case 'charge.refunded':
        await handleChargeRefunded(
          event.data.object as Stripe.Charge,
          connectedAccountId
        )
        break

      // Account events
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account)
        break

      default:
        console.log(`Unhandled Connect event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error(`Connect webhook handler error for ${event.type}:`, error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  connectedAccountId?: string
) {
  // Only handle payment mode (not subscription)
  if (session.mode !== 'payment') return

  const reservationId = session.metadata?.reservationId
  if (!reservationId) {
    console.error('No reservationId in checkout session metadata')
    return
  }

  // Check idempotence: if payment already completed for this session, skip
  const existingPayment = await db.query.payments.findFirst({
    where: eq(payments.stripeCheckoutSessionId, session.id),
  })

  if (existingPayment?.status === 'completed') {
    console.log(`Payment already completed for session ${session.id}, skipping`)
    return
  }

  // Get reservation
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
    },
  })

  if (!reservation) {
    console.error(`Reservation ${reservationId} not found`)
    return
  }

  // If reservation is already confirmed (e.g., by success page), skip
  if (reservation.status !== 'pending') {
    console.log(`Reservation ${reservationId} already ${reservation.status}, updating payment only`)
  }

  // Get payment intent details and extract customer/payment method
  let paymentIntentId: string | null = null
  let chargeId: string | null = null
  let stripeCustomerId: string | null = null
  let stripePaymentMethodId: string | null = null

  if (session.payment_intent && connectedAccountId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        session.payment_intent as string,
        { stripeAccount: connectedAccountId }
      )
      paymentIntentId = paymentIntent.id
      chargeId = paymentIntent.latest_charge as string | null
      stripeCustomerId = paymentIntent.customer as string | null
      stripePaymentMethodId = paymentIntent.payment_method as string | null
    } catch (error) {
      console.error('Failed to retrieve payment intent:', error)
    }
  }

  // If we don't have customer from payment intent, get from session
  if (!stripeCustomerId && session.customer) {
    stripeCustomerId = session.customer as string
  }

  const currency = session.currency?.toUpperCase() || 'EUR'
  const totalAmount = fromStripeCents(session.amount_total || 0, currency)
  const depositAmount = Number(reservation.depositAmount) || 0

  // Determine deposit status based on whether there's a deposit and card was saved
  let newDepositStatus: 'none' | 'card_saved' | 'pending' = 'none'
  if (depositAmount > 0) {
    // If we have both customer and payment method, card is saved
    newDepositStatus = stripeCustomerId && stripePaymentMethodId ? 'card_saved' : 'pending'
  }

  // Update existing pending payment or create new one
  if (existingPayment && existingPayment.status === 'pending') {
    // Update the pending payment created during checkout
    await db
      .update(payments)
      .set({
        status: 'completed',
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
        stripePaymentMethodId,
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, existingPayment.id))
  } else if (!existingPayment) {
    // Create payment record (fallback if pending payment wasn't created)
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: totalAmount.toFixed(2),
      type: 'rental',
      method: 'stripe',
      status: 'completed',
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      stripeCheckoutSessionId: session.id,
      stripePaymentMethodId,
      currency,
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Update reservation only if still pending
  if (reservation.status === 'pending') {
    await db
      .update(reservations)
      .set({
        status: 'confirmed',
        stripeCustomerId,
        stripePaymentMethodId,
        depositStatus: newDepositStatus,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId))

    // Log payment received activity
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'payment_received',
      description: null,
      metadata: {
        paymentIntentId,
        chargeId,
        checkoutSessionId: session.id,
        amount: totalAmount,
        currency,
        method: 'stripe',
        type: 'rental',
      },
      createdAt: new Date(),
    })

    // Log confirmation activity
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'confirmed',
      description: null,
      metadata: {
        source: 'online_payment',
        depositAmount,
        depositStatus: newDepositStatus,
        cardSaved: !!stripePaymentMethodId,
      },
      createdAt: new Date(),
    })

    console.log(`Reservation ${reservationId} confirmed via webhook. Deposit status: ${newDepositStatus}`)
  } else {
    console.log(`Reservation ${reservationId} already processed, payment record updated`)
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const reservationId = session.metadata?.reservationId
  if (!reservationId) return

  console.log(`Checkout session expired for reservation ${reservationId}`)
  // Could send a reminder email here if needed
}

// ============================================================================
// Deposit Authorization Hold Event Handlers
// ============================================================================

/**
 * Handles successful deposit authorization (empreinte created)
 * Triggered when PaymentIntent status becomes requires_capture
 */
async function handleDepositAuthorized(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== 'deposit_hold') return

  const reservationId = paymentIntent.metadata?.reservationId
  if (!reservationId) {
    console.error('No reservationId in deposit PaymentIntent metadata')
    return
  }

  // Check idempotence
  const existingPayment = await db.query.payments.findFirst({
    where: eq(payments.stripePaymentIntentId, paymentIntent.id),
  })

  if (existingPayment) {
    console.log(`Deposit hold already recorded for PI ${paymentIntent.id}, skipping`)
    return
  }

  const currency = paymentIntent.currency.toUpperCase()
  const amount = fromStripeCents(paymentIntent.amount, currency)

  // Authorization expires after 7 days
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  // Create payment record for the authorization hold
  await db.insert(payments).values({
    id: nanoid(),
    reservationId,
    amount: amount.toFixed(2),
    type: 'deposit_hold',
    method: 'stripe',
    status: 'authorized',
    stripePaymentIntentId: paymentIntent.id,
    stripePaymentMethodId: paymentIntent.payment_method as string | null,
    authorizationExpiresAt: expiresAt,
    currency,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Update reservation deposit status
  await db
    .update(reservations)
    .set({
      depositStatus: 'authorized',
      depositPaymentIntentId: paymentIntent.id,
      depositAuthorizationExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'deposit_authorized',
    description: `Deposit authorization of ${amount.toFixed(2)} ${currency} created`,
    metadata: {
      paymentIntentId: paymentIntent.id,
      amount,
      expiresAt: expiresAt.toISOString(),
    },
    createdAt: new Date(),
  })

  console.log(`Deposit authorization created for reservation ${reservationId}`)
}

/**
 * Handles deposit release (authorization cancelled)
 * Triggered when PaymentIntent is cancelled
 */
async function handleDepositReleased(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== 'deposit_hold') return

  const reservationId = paymentIntent.metadata?.reservationId
  if (!reservationId) return

  // Find and update the deposit hold payment
  const depositPayment = await db.query.payments.findFirst({
    where: eq(payments.stripePaymentIntentId, paymentIntent.id),
  })

  if (depositPayment) {
    await db
      .update(payments)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(payments.id, depositPayment.id))
  }

  // Update reservation deposit status
  await db
    .update(reservations)
    .set({
      depositStatus: 'released',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  const currency = paymentIntent.currency.toUpperCase()
  const amount = fromStripeCents(paymentIntent.amount, currency)

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'deposit_released',
    description: `Deposit of ${amount.toFixed(2)} ${currency} released`,
    metadata: {
      paymentIntentId: paymentIntent.id,
      amount,
    },
    createdAt: new Date(),
  })

  console.log(`Deposit released for reservation ${reservationId}`)
}

/**
 * Handles deposit capture (partial or full)
 * Triggered when PaymentIntent succeeds after capture
 */
async function handleDepositCaptured(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== 'deposit_hold') return

  const reservationId = paymentIntent.metadata?.reservationId
  if (!reservationId) return

  const currency = paymentIntent.currency.toUpperCase()
  const capturedAmount = fromStripeCents(paymentIntent.amount_received, currency)
  const originalAmount = fromStripeCents(paymentIntent.amount, currency)

  // Find and update the deposit hold payment
  const depositPayment = await db.query.payments.findFirst({
    where: eq(payments.stripePaymentIntentId, paymentIntent.id),
  })

  if (depositPayment) {
    await db
      .update(payments)
      .set({
        status: 'completed',
        capturedAmount: capturedAmount.toFixed(2),
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, depositPayment.id))
  }

  // Create a deposit_capture payment record if partial capture
  if (capturedAmount > 0) {
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: capturedAmount.toFixed(2),
      type: 'deposit_capture',
      method: 'stripe',
      status: 'completed',
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: paymentIntent.latest_charge as string | null,
      currency,
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Update reservation deposit status
  await db
    .update(reservations)
    .set({
      depositStatus: 'captured',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'deposit_captured',
    description: `Deposit of ${capturedAmount.toFixed(2)} ${currency} captured (original: ${originalAmount.toFixed(2)} ${currency})`,
    metadata: {
      paymentIntentId: paymentIntent.id,
      capturedAmount,
      originalAmount,
      reason: paymentIntent.metadata?.captureReason || null,
    },
    createdAt: new Date(),
  })

  console.log(`Deposit captured for reservation ${reservationId}: ${capturedAmount} ${currency}`)
}

/**
 * Handles deposit authorization failure
 * Triggered when card is declined or authorization fails
 */
async function handleDepositFailed(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string
) {
  // Only handle deposit_hold type payments
  if (paymentIntent.metadata?.type !== 'deposit_hold') return

  const reservationId = paymentIntent.metadata?.reservationId
  if (!reservationId) return

  // Update reservation deposit status
  await db
    .update(reservations)
    .set({
      depositStatus: 'failed',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  const currency = paymentIntent.currency.toUpperCase()
  const amount = fromStripeCents(paymentIntent.amount, currency)

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'deposit_failed',
    description: `Deposit authorization of ${amount.toFixed(2)} ${currency} failed`,
    metadata: {
      paymentIntentId: paymentIntent.id,
      amount,
      error: paymentIntent.last_payment_error?.message || 'Unknown error',
    },
    createdAt: new Date(),
  })

  console.log(`Deposit authorization failed for reservation ${reservationId}`)
  // TODO: Send notification to store owner
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  connectedAccountId?: string
) {
  // Find payment by charge ID
  const payment = await db.query.payments.findFirst({
    where: eq(payments.stripeChargeId, charge.id),
  })

  if (!payment) {
    console.log(`No payment found for charge ${charge.id}`)
    return
  }

  const currency = charge.currency.toUpperCase()
  const refundAmount = fromStripeCents(charge.amount_refunded, currency)
  const isFullRefund = charge.refunded

  // Update payment status (only mark as refunded if fully refunded)
  await db
    .update(payments)
    .set({
      status: isFullRefund ? 'refunded' : 'completed',
      stripeRefundId: charge.refunds?.data[0]?.id || null,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id))

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId: payment.reservationId,
    activityType: 'payment_updated',
    description: `Refund of ${refundAmount.toFixed(2)} ${currency} processed`,
    metadata: {
      chargeId: charge.id,
      refundAmount,
      isFullRefund,
    },
    createdAt: new Date(),
  })

  console.log(`Refund processed for payment ${payment.id}`)
}

async function handleAccountUpdated(account: Stripe.Account) {
  // Find store by connected account ID
  const store = await db.query.stores.findFirst({
    where: eq(stores.stripeAccountId, account.id),
  })

  if (!store) {
    console.log(`No store found for account ${account.id}`)
    return
  }

  // Update store with latest status
  const chargesEnabled = account.charges_enabled ?? false
  const detailsSubmitted = account.details_submitted ?? false

  await db
    .update(stores)
    .set({
      stripeChargesEnabled: chargesEnabled,
      stripeOnboardingComplete: chargesEnabled && detailsSubmitted,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  console.log(`Store ${store.id} Stripe status updated: charges=${chargesEnabled}`)
}

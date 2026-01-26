import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/client'
import { db } from '@/lib/db'
import { payments, reservations, stores, reservationActivity, customers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { fromStripeCents } from '@/lib/stripe'
import { dispatchNotification } from '@/lib/notifications/dispatcher'
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher'
import type { NotificationSettings, StoreSettings } from '@/types/store'
import {
  notifyPaymentReceived,
  notifyReservationConfirmed,
  notifyPaymentFailed,
  notifyStripeConnected,
} from '@/lib/discord/platform-notifications'

// ===== TYPE DEFINITIONS =====
// Define explicit type for reservation with relations to ensure proper typing
// Only includes fields we actually use in webhook handlers

type ReservationStore = {
  id: string
  name: string
  slug: string
  email: string | null
  stripeAccountId: string | null
  discordWebhookUrl: string | null
  ownerPhone: string | null
  notificationSettings: NotificationSettings | null
  settings: StoreSettings | null
}

type ReservationCustomer = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
}

type ReservationWithRelations = {
  id: string
  number: string
  storeId: string
  customerId: string | null
  status: string
  startDate: Date
  endDate: Date
  totalAmount: string
  depositAmount: string | null
  depositStatus: string | null
  store: ReservationStore
  customer: ReservationCustomer | null
  items: Array<{
    id: string
    productId: string
    quantity: number
    unitPrice: string
    totalPrice: string
  }>
}

// ===== VALIDATION HELPERS =====
// Validates Stripe metadata to prevent manipulation attacks

/**
 * Validates that a reservationId from Stripe metadata is properly formatted
 * @returns true if valid, false otherwise
 */
function isValidReservationId(reservationId: string | undefined): reservationId is string {
  return typeof reservationId === 'string' && reservationId.length === 21
}

/**
 * Validates that the connected account matches the reservation's store
 * Prevents attacks where metadata is manipulated
 */
async function validateConnectedAccountForReservation(
  reservationId: string,
  connectedAccountId: string | undefined,
  eventType: string
): Promise<{ valid: boolean; reservation?: ReservationWithRelations }> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  })

  if (!reservation) {
    console.error(`[${eventType}] Reservation ${reservationId} not found`)
    return { valid: false }
  }

  // If we have a connected account, validate it matches the store
  if (connectedAccountId && reservation.store.stripeAccountId !== connectedAccountId) {
    console.error(`[SECURITY] [${eventType}] Connected account mismatch - possible attack`, {
      expected: reservation.store.stripeAccountId,
      received: connectedAccountId,
      reservationId,
    })
    return { valid: false }
  }

  // Type assertion safe: Drizzle returns matching structure from 'with' clause
  return { valid: true, reservation: reservation as ReservationWithRelations }
}

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

  // SECURITY: Validate reservationId format (nanoid 21 chars)
  if (reservationId.length !== 21) {
    console.error('[SECURITY] Invalid reservationId format in metadata', { reservationId })
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

  // Get reservation with store, customer, and items for notifications
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  })

  if (!reservation) {
    console.error(`Reservation ${reservationId} not found`)
    return
  }

  // Validate connected account matches store to prevent metadata manipulation
  if (connectedAccountId && reservation.store.stripeAccountId !== connectedAccountId) {
    console.error('[SECURITY] Connected account mismatch - possible attack detected', {
      expected: reservation.store.stripeAccountId,
      received: connectedAccountId,
      reservationId,
      sessionId: session.id,
    })
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

    // Dispatch admin notifications (SMS, Discord) for payment received
    dispatchNotification('payment_received', {
      store: {
        id: reservation.store.id,
        name: reservation.store.name,
        email: reservation.store.email,
        discordWebhookUrl: reservation.store.discordWebhookUrl,
        ownerPhone: reservation.store.ownerPhone,
        notificationSettings: reservation.store.notificationSettings,
        settings: reservation.store.settings,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: Number(reservation.totalAmount),
      },
      customer: reservation.customer
        ? {
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone,
          }
        : undefined,
      payment: {
        amount: totalAmount,
      },
    }).catch((error) => {
      console.error('Failed to dispatch payment received notification:', error)
    })

    // Also dispatch confirmation notification
    dispatchNotification('reservation_confirmed', {
      store: {
        id: reservation.store.id,
        name: reservation.store.name,
        email: reservation.store.email,
        discordWebhookUrl: reservation.store.discordWebhookUrl,
        ownerPhone: reservation.store.ownerPhone,
        notificationSettings: reservation.store.notificationSettings,
        settings: reservation.store.settings,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: Number(reservation.totalAmount),
      },
      customer: reservation.customer
        ? {
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone,
          }
        : undefined,
    }).catch((error) => {
      console.error('Failed to dispatch confirmation notification:', error)
    })

    // Dispatch customer notification for reservation confirmed (email/SMS based on store preferences)
    if (reservation.customer) {
      const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
      const reservationUrl = `https://${reservation.store.slug}.${domain}/account/reservations/${reservationId}`

      const emailItems = reservation.items?.map((item) => ({
        name: item.productSnapshot?.name || 'Product',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
      })) || []

      dispatchCustomerNotification('customer_reservation_confirmed', {
        store: {
          id: reservation.store.id,
          name: reservation.store.name,
          email: reservation.store.email,
          logoUrl: reservation.store.logoUrl,
          address: reservation.store.address,
          phone: reservation.store.phone,
          theme: reservation.store.theme,
          settings: reservation.store.settings,
          emailSettings: reservation.store.emailSettings,
          customerNotificationSettings: reservation.store.customerNotificationSettings,
        },
        customer: {
          id: reservation.customer.id,
          firstName: reservation.customer.firstName,
          lastName: reservation.customer.lastName,
          email: reservation.customer.email,
          phone: reservation.customer.phone,
        },
        reservation: {
          id: reservationId,
          number: reservation.number,
          startDate: reservation.startDate,
          endDate: reservation.endDate,
          totalAmount: Number(reservation.totalAmount),
          subtotalAmount: Number(reservation.subtotalAmount),
          depositAmount: Number(reservation.depositAmount),
          taxEnabled: !!reservation.taxRate,
          taxRate: reservation.taxRate ? Number(reservation.taxRate) : null,
          subtotalExclTax: reservation.subtotalExclTax ? Number(reservation.subtotalExclTax) : null,
          taxAmount: reservation.taxAmount ? Number(reservation.taxAmount) : null,
        },
        items: emailItems,
        reservationUrl,
      }).catch((error) => {
        console.error('Failed to dispatch customer reservation confirmed notification:', error)
      })
    }

    // Platform admin notifications
    const storeInfo = { id: reservation.store.id, name: reservation.store.name, slug: reservation.store.slug }
    notifyPaymentReceived(storeInfo, reservation.number, totalAmount, currency).catch(() => {})
    notifyReservationConfirmed(storeInfo, reservation.number).catch(() => {})

    console.log(`Reservation ${reservationId} confirmed via webhook. Deposit status: ${newDepositStatus}`)
  } else {
    console.log(`Reservation ${reservationId} already processed, payment record updated`)
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const reservationId = session.metadata?.reservationId
  if (!reservationId) return

  const currency = session.currency?.toUpperCase() || 'EUR'
  const amount = fromStripeCents(session.amount_total || 0, currency)

  // Update pending payment to failed/cancelled
  const existingPayment = await db.query.payments.findFirst({
    where: eq(payments.stripeCheckoutSessionId, session.id),
  })

  if (existingPayment && existingPayment.status === 'pending') {
    await db
      .update(payments)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(payments.id, existingPayment.id))
  }

  // Log payment expired activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'payment_expired',
    description: null,
    metadata: {
      checkoutSessionId: session.id,
      amount,
      currency,
      method: 'stripe',
    },
    createdAt: new Date(),
  })

  console.log(`Checkout session expired for reservation ${reservationId}`)
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

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    console.error('[SECURITY] Invalid reservationId in deposit PaymentIntent metadata', { reservationId })
    return
  }

  // SECURITY: Validate connected account matches store
  const { valid, reservation } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    'deposit_authorized'
  )
  if (!valid) return

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

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    console.error('[SECURITY] Invalid reservationId in deposit release metadata', { reservationId })
    return
  }

  // SECURITY: Validate connected account matches store
  const { valid } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    'deposit_released'
  )
  if (!valid) return

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

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    console.error('[SECURITY] Invalid reservationId in deposit capture metadata', { reservationId })
    return
  }

  // SECURITY: Validate connected account matches store
  const { valid } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    'deposit_captured'
  )
  if (!valid) return

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
 * Handles payment failure
 * Triggered when card is declined or payment fails
 */
async function handleDepositFailed(
  paymentIntent: Stripe.PaymentIntent,
  connectedAccountId?: string
) {
  const reservationId = paymentIntent.metadata?.reservationId

  // SECURITY: Validate reservationId format
  if (!isValidReservationId(reservationId)) {
    console.error('[SECURITY] Invalid reservationId in payment failed metadata', { reservationId })
    return
  }

  // SECURITY: Validate connected account matches store
  const { valid, reservation } = await validateConnectedAccountForReservation(
    reservationId,
    connectedAccountId,
    'payment_failed'
  )
  if (!valid || !reservation) return

  const currency = paymentIntent.currency.toUpperCase()
  const amount = fromStripeCents(paymentIntent.amount, currency)
  const errorMessage = paymentIntent.last_payment_error?.message || 'Unknown error'
  const isDepositHold = paymentIntent.metadata?.type === 'deposit_hold'

  if (isDepositHold) {
    // Handle deposit authorization failure
    await db
      .update(reservations)
      .set({
        depositStatus: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId))

    // Log deposit failed activity
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'deposit_failed',
      description: `Deposit authorization of ${amount.toFixed(2)} ${currency} failed`,
      metadata: {
        paymentIntentId: paymentIntent.id,
        amount,
        error: errorMessage,
      },
      createdAt: new Date(),
    })

    console.log(`Deposit authorization failed for reservation ${reservationId}`)
  } else {
    // Handle rental payment failure
    // Update pending payment to failed
    const existingPayment = await db.query.payments.findFirst({
      where: eq(payments.stripePaymentIntentId, paymentIntent.id),
    })

    if (existingPayment && existingPayment.status === 'pending') {
      await db
        .update(payments)
        .set({
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(payments.id, existingPayment.id))
    }

    // Log payment failed activity
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'payment_failed',
      description: errorMessage,
      metadata: {
        paymentIntentId: paymentIntent.id,
        amount,
        currency,
        method: 'stripe',
        error: errorMessage,
      },
      createdAt: new Date(),
    })

    console.log(`Payment failed for reservation ${reservationId}: ${errorMessage}`)
  }

  // Dispatch admin notification for payment failure
  if (reservation) {
    dispatchNotification('payment_failed', {
      store: {
        id: reservation.store.id,
        name: reservation.store.name,
        email: reservation.store.email,
        discordWebhookUrl: reservation.store.discordWebhookUrl,
        ownerPhone: reservation.store.ownerPhone,
        notificationSettings: reservation.store.notificationSettings,
        settings: reservation.store.settings,
      },
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: Number(reservation.totalAmount),
      },
      customer: reservation.customer
        ? {
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone,
          }
        : undefined,
      payment: {
        amount,
      },
    }).catch((error) => {
      console.error('Failed to dispatch payment failed notification:', error)
    })

    // Platform admin notification
    notifyPaymentFailed(
      { id: reservation.store.id, name: reservation.store.name, slug: reservation.store.slug },
      reservation.number
    ).catch(() => {})
  }
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

  // Platform admin notification (only on first successful onboarding)
  if (chargesEnabled && detailsSubmitted && !store.stripeOnboardingComplete) {
    notifyStripeConnected({ id: store.id, name: store.name, slug: store.slug }).catch(() => {})
  }

  console.log(`Store ${store.id} Stripe status updated: charges=${chargesEnabled}`)
}

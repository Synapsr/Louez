'use server'

import { db } from '@/lib/db'
import { stores, reservations, payments, reservationActivity, verificationCodes } from '@/lib/db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { createDepositAuthorizationIntent, toStripeCents } from '@/lib/stripe'
import { nanoid } from 'nanoid'
import type { StoreSettings } from '@/types/store'

interface GetDepositAuthorizationDataParams {
  slug: string
  reservationId: string
  token?: string
}

/**
 * Get deposit authorization data for the page
 * Validates access via token or customer session
 */
export async function getDepositAuthorizationData({
  slug,
  reservationId,
  token,
}: GetDepositAuthorizationDataParams) {
  // Get store
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { error: 'store_not_found' }
  }

  // Get reservation with customer
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
    },
  })

  if (!reservation) {
    return { error: 'reservation_not_found' }
  }

  // Validate access via token (from verificationCodes table)
  if (token) {
    const verificationCode = await db.query.verificationCodes.findFirst({
      where: and(
        eq(verificationCodes.token, token),
        eq(verificationCodes.reservationId, reservationId),
        eq(verificationCodes.storeId, store.id),
        gt(verificationCodes.expiresAt, new Date())
      ),
    })

    if (!verificationCode) {
      return { error: 'invalid_token' }
    }
  }

  // Check if store has Stripe connected
  if (!store.stripeAccountId) {
    return { error: 'stripe_not_configured' }
  }

  // Check if deposit is already authorized
  if (reservation.depositStatus === 'authorized' || reservation.depositStatus === 'captured') {
    return { error: 'deposit_already_authorized' }
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'
  const depositAmount = parseFloat(reservation.depositAmount || '0')

  if (depositAmount <= 0) {
    return { error: 'no_deposit_required' }
  }

  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      stripeAccountId: store.stripeAccountId,
      logoUrl: store.logoUrl,
      theme: store.theme,
      country: storeSettings.country,
    },
    reservation: {
      id: reservation.id,
      number: reservation.number,
      depositAmount,
    },
    customer: {
      id: reservation.customer.id,
      firstName: reservation.customer.firstName,
      email: reservation.customer.email,
    },
    currency,
  }
}

interface CreateDepositPaymentIntentParams {
  reservationId: string
  storeId: string
}

/**
 * Create a PaymentIntent for deposit authorization
 * Returns the client secret for Stripe Elements
 */
export async function createDepositPaymentIntent({
  reservationId,
  storeId,
}: CreateDepositPaymentIntentParams) {
  // Get store with Stripe account
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  })

  if (!store || !store.stripeAccountId) {
    return { error: 'stripe_not_configured' }
  }

  // Get reservation
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, storeId)
    ),
  })

  if (!reservation) {
    return { error: 'reservation_not_found' }
  }

  // Check if deposit is already authorized
  if (reservation.depositStatus === 'authorized' || reservation.depositStatus === 'captured') {
    return { error: 'deposit_already_authorized' }
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'
  const depositAmount = parseFloat(reservation.depositAmount || '0')

  if (depositAmount <= 0) {
    return { error: 'no_deposit_required' }
  }

  try {
    // Create PaymentIntent with capture_method='manual'
    const result = await createDepositAuthorizationIntent({
      stripeAccountId: store.stripeAccountId,
      amount: toStripeCents(depositAmount, currency),
      currency,
      reservationId: reservation.id,
      reservationNumber: reservation.number,
    })

    return {
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
    }
  } catch (error) {
    console.error('Error creating deposit PaymentIntent:', error)
    return { error: 'payment_intent_creation_failed' }
  }
}

interface ConfirmDepositAuthorizationParams {
  reservationId: string
  storeId: string
  paymentIntentId: string
  paymentMethodId: string
}

/**
 * Confirm the deposit authorization was successful
 * Updates the reservation with deposit status
 */
export async function confirmDepositAuthorization({
  reservationId,
  storeId,
  paymentIntentId,
  paymentMethodId,
}: ConfirmDepositAuthorizationParams) {
  // Get reservation
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, storeId)
    ),
  })

  if (!reservation) {
    return { error: 'reservation_not_found' }
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  })

  if (!store) {
    return { error: 'store_not_found' }
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'
  const depositAmount = parseFloat(reservation.depositAmount || '0')

  try {
    // Update reservation with deposit info
    await db
      .update(reservations)
      .set({
        depositStatus: 'authorized',
        depositPaymentIntentId: paymentIntentId,
        stripePaymentMethodId: paymentMethodId,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservationId))

    // Create payment record for the hold
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: depositAmount.toFixed(2),
      currency,
      status: 'authorized',
      type: 'deposit_hold',
      method: 'card',
      stripePaymentIntentId: paymentIntentId,
      stripePaymentMethodId: paymentMethodId,
      notes: 'Deposit authorization hold',
    })

    // Log activity
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'deposit_authorized',
      metadata: {
        paymentIntentId,
        amount: depositAmount,
        currency,
      },
    })

    return { success: true }
  } catch (error) {
    console.error('Error confirming deposit authorization:', error)
    return { error: 'confirmation_failed' }
  }
}

'use server'

import { db } from '@louez/db'
import { stores, reservations, paymentRequests, verificationCodes } from '@louez/db'
import { eq, and, gt } from 'drizzle-orm'
import { createPaymentRequestSession, toStripeCents } from '@/lib/stripe'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { nanoid } from 'nanoid'
import type { StoreSettings } from '@louez/types'

interface GetPaymentRequestDataParams {
  slug: string
  reservationId: string
  token: string
}

export async function getPaymentRequestData({
  slug,
  reservationId,
  token,
}: GetPaymentRequestDataParams) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { error: 'store_not_found' as const }
  }

  const paymentRequest = await db.query.paymentRequests.findFirst({
    where: and(
      eq(paymentRequests.token, token),
      eq(paymentRequests.reservationId, reservationId),
      eq(paymentRequests.storeId, store.id),
      gt(paymentRequests.expiresAt, new Date())
    ),
  })

  if (!paymentRequest) {
    return { error: 'invalid_token' as const, storeId: store.id }
  }

  if (paymentRequest.status === 'completed') {
    return { error: 'already_paid' as const, storeId: store.id }
  }

  if (paymentRequest.status === 'cancelled') {
    return { error: 'cancelled' as const, storeId: store.id }
  }

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
    return { error: 'reservation_not_found' as const, storeId: store.id }
  }

  if (!store.stripeAccountId) {
    return { error: 'stripe_not_configured' as const, storeId: store.id }
  }

  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      stripeAccountId: store.stripeAccountId,
      logoUrl: store.logoUrl,
      theme: store.theme,
    },
    reservation: {
      id: reservation.id,
      number: reservation.number,
    },
    paymentRequest: {
      id: paymentRequest.id,
      amount: parseFloat(paymentRequest.amount),
      currency: paymentRequest.currency,
      description: paymentRequest.description,
      type: paymentRequest.type,
    },
    customer: {
      email: reservation.customer.email,
      firstName: reservation.customer.firstName,
    },
  }
}

interface InitiatePaymentParams {
  paymentRequestId: string
  token: string
}

export async function initiatePayment({
  paymentRequestId,
  token,
}: InitiatePaymentParams): Promise<{ url: string } | { error: string }> {
  // Re-validate token
  const paymentRequest = await db.query.paymentRequests.findFirst({
    where: and(
      eq(paymentRequests.id, paymentRequestId),
      eq(paymentRequests.token, token),
      gt(paymentRequests.expiresAt, new Date())
    ),
  })

  if (!paymentRequest || paymentRequest.status !== 'pending') {
    return { error: 'invalid_request' }
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, paymentRequest.storeId),
  })

  if (!store?.stripeAccountId) {
    return { error: 'stripe_not_configured' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, paymentRequest.reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
    },
  })

  if (!reservation) {
    return { error: 'reservation_not_found' }
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = paymentRequest.currency
  const amount = parseFloat(paymentRequest.amount)

  // Create instant access token for auto-login after payment
  const accessToken = nanoid(64)
  const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await db.insert(verificationCodes).values({
    id: nanoid(),
    email: reservation.customer.email,
    storeId: store.id,
    code: '',
    type: 'instant_access',
    token: accessToken,
    reservationId: reservation.id,
    expiresAt: tokenExpiresAt,
    createdAt: new Date(),
  })

  const successUrl = getStorefrontUrl(
    store.slug,
    `/account/success?token=${accessToken}&type=payment&reservation=${reservation.id}`
  )
  const cancelUrl = getStorefrontUrl(
    store.slug,
    `/pay/${reservation.id}?token=${token}`
  )

  const locale = storeSettings.country
    ? getStripeLocale(storeSettings.country)
    : undefined

  try {
    const session = await createPaymentRequestSession({
      stripeAccountId: store.stripeAccountId,
      reservationId: reservation.id,
      reservationNumber: reservation.number,
      customerEmail: reservation.customer.email,
      amount: toStripeCents(amount, currency),
      description: `${paymentRequest.description} - Reservation #${reservation.number}`,
      currency,
      successUrl,
      cancelUrl,
      paymentRequestId: paymentRequest.id,
      locale,
    })

    return { url: session.url }
  } catch (error) {
    console.error('Failed to create payment session:', error)
    return { error: 'session_creation_failed' }
  }
}

function getStripeLocale(country: string): string {
  const countryLocaleMap: Record<string, string> = {
    FR: 'fr', DE: 'de', ES: 'es', IT: 'it',
    NL: 'nl', PL: 'pl', PT: 'pt', BE: 'fr',
    CH: 'fr', AT: 'de', LU: 'fr',
  }
  return countryLocaleMap[country] || 'auto'
}

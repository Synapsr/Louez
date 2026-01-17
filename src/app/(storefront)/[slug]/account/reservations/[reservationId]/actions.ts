'use server'

import { db } from '@/lib/db'
import { stores, reservations, payments, reservationActivity } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createCheckoutSession, toStripeCents } from '@/lib/stripe'
import { getCustomerSession } from '../../actions'
import { calculateDuration } from '@/lib/pricing'

export async function createReservationPaymentSession(
  storeSlug: string,
  reservationId: string
) {
  try {
    // Verify customer session
    const session = await getCustomerSession(storeSlug)
    if (!session) {
      return { error: 'errors.unauthorized' }
    }

    // Get store
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, storeSlug),
    })

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Check Stripe is enabled
    if (!store.stripeAccountId || !store.stripeChargesEnabled) {
      return { error: 'errors.paymentNotAvailable' }
    }

    // Get reservation
    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, reservationId),
        eq(reservations.storeId, store.id),
        eq(reservations.customerId, session.customerId)
      ),
      with: {
        customer: true,
        items: true,
        payments: true,
      },
    })

    if (!reservation) {
      return { error: 'errors.reservationNotFound' }
    }

    // Check if already paid (rental payment completed)
    const isPaid = reservation.payments.some(
      (p) => p.type === 'rental' && p.status === 'completed'
    )
    if (isPaid) {
      return { error: 'errors.alreadyPaid' }
    }

    // Check for pending payment
    const hasPendingPayment = reservation.payments.some(
      (p) => p.type === 'rental' && p.status === 'pending'
    )
    if (hasPendingPayment) {
      return { error: 'errors.paymentInProgress' }
    }

    const currency = store.settings?.currency || 'EUR'
    const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
    const protocol = domain.includes('localhost') ? 'http' : 'https'
    const baseUrl = `${protocol}://${store.slug}.${domain}`

    // Calculate duration
    const duration = calculateDuration(
      reservation.startDate,
      reservation.endDate,
      store.settings?.pricingMode || 'day'
    )

    // Build line items from reservation items
    const lineItems = reservation.items.map((item) => ({
      name: item.productSnapshot.name,
      description: item.productSnapshot.description || undefined,
      quantity: item.quantity,
      unitAmount: toStripeCents(parseFloat(item.unitPrice) * duration, currency),
    }))

    // Create checkout session
    const { url, sessionId } = await createCheckoutSession({
      stripeAccountId: store.stripeAccountId,
      reservationId,
      reservationNumber: reservation.number,
      customerEmail: reservation.customer.email,
      lineItems,
      depositAmount: toStripeCents(parseFloat(reservation.depositAmount), currency),
      currency,
      successUrl: `${baseUrl}/account/reservations/${reservationId}?payment=success`,
      cancelUrl: `${baseUrl}/account/reservations/${reservationId}?payment=cancelled`,
    })

    // Create pending payment record
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: reservation.subtotalAmount,
      type: 'rental',
      method: 'stripe',
      status: 'pending',
      stripeCheckoutSessionId: sessionId,
      currency,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Log activity
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'payment_initiated',
      description: 'Customer initiated payment from account',
      metadata: { checkoutSessionId: sessionId, source: 'account_page' },
      createdAt: new Date(),
    })

    return { success: true, paymentUrl: url }
  } catch (error) {
    console.error('Error creating payment session:', error)
    return { error: 'errors.paymentSessionError' }
  }
}

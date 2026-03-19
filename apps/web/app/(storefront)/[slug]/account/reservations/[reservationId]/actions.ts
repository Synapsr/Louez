'use server'

import { db } from '@louez/db'
import { stores, reservations, payments, reservationActivity } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createCheckoutSession, toStripeCents } from '@/lib/stripe'
import { getStripe } from '@/lib/stripe/client'
import { getCustomerSession } from '../../actions'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { revalidatePath } from 'next/cache'
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher'
import { dispatchNotification } from '@/lib/notifications/dispatcher'

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

    // Cancel any stale pending payments so the customer can retry
    const pendingPayments = reservation.payments.filter(
      (p) => p.type === 'rental' && p.status === 'pending'
    )
    for (const pending of pendingPayments) {
      // Expire the Stripe checkout session if it exists
      if (pending.stripeCheckoutSessionId) {
        try {
          await getStripe().checkout.sessions.expire(
            pending.stripeCheckoutSessionId,
            { stripeAccount: store.stripeAccountId! },
          )
        } catch {
          // Session may already be expired or completed — safe to ignore
        }
      }
      await db
        .update(payments)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(payments.id, pending.id))
    }

    const currency = store.settings?.currency || 'EUR'

    // Build line items from reservation items
    const lineItems: { name: string; description?: string; quantity: number; unitAmount: number }[] = reservation.items.map((item) => ({
      name: item.productSnapshot.name,
      quantity: 1,
      unitAmount: toStripeCents(parseFloat(item.totalPrice), currency),
    }))

    // Add delivery fee as a line item if present
    const deliveryFee = parseFloat(reservation.deliveryFee || '0')
    if (deliveryFee > 0) {
      lineItems.push({
        name: 'Delivery',
        quantity: 1,
        unitAmount: toStripeCents(deliveryFee, currency),
      })
    }

    // Create checkout session
    const { url, sessionId } = await createCheckoutSession({
      stripeAccountId: store.stripeAccountId,
      reservationId,
      reservationNumber: reservation.number,
      customerEmail: reservation.customer.email,
      lineItems,
      depositAmount: toStripeCents(parseFloat(reservation.depositAmount), currency),
      currency,
      successUrl: getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}?payment=success`),
      cancelUrl: getStorefrontUrl(storeSlug, `/account/reservations/${reservationId}?payment=cancelled`),
    })

    // Create pending payment record
    await db.insert(payments).values({
      id: nanoid(),
      reservationId,
      amount: reservation.totalAmount,
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
      metadata: { checkoutSessionId: sessionId, source: 'account_page' },
      createdAt: new Date(),
    })

    return { success: true, paymentUrl: url }
  } catch (error) {
    console.error('Error creating payment session:', error)
    return { error: 'errors.paymentSessionError' }
  }
}

export async function acceptQuote(
  storeSlug: string,
  reservationId: string
) {
  const session = await getCustomerSession(storeSlug)
  if (!session) {
    return { error: 'errors.unauthorized' }
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  })

  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId)
    ),
    with: {
      customer: true,
      items: true,
    },
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  if (reservation.status !== 'quote') {
    return { error: 'errors.invalidStatus' }
  }

  // Move to confirmed
  await db
    .update(reservations)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(eq(reservations.id, reservationId))

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'quote_accepted',
    metadata: { source: 'customer' },
    createdAt: new Date(),
  })

  // Notify the store owner
  dispatchNotification('reservation_confirmed', {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    console.error('Failed to dispatch quote accepted notification:', error)
  })

  // Notify the customer with confirmation email
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN
  const reservationUrl = `https://${store.slug}.${domain}/account/reservations/${reservationId}`

  const emailItems = reservation.items.map((item) => ({
    name: item.productSnapshot?.name || 'Product',
    quantity: item.quantity,
    unitPrice: parseFloat(item.unitPrice),
    totalPrice: parseFloat(item.totalPrice),
  }))

  dispatchCustomerNotification('customer_quote_accepted', {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      address: store.address,
      phone: store.phone,
      theme: store.theme,
      settings: store.settings,
      emailSettings: store.emailSettings,
      customerNotificationSettings: store.customerNotificationSettings,
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
      totalAmount: parseFloat(reservation.totalAmount),
      subtotalAmount: parseFloat(reservation.subtotalAmount),
      depositAmount: parseFloat(reservation.depositAmount),
    },
    items: emailItems,
    reservationUrl,
  }).catch((error) => {
    console.error('Failed to dispatch quote accepted customer notification:', error)
  })

  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`)
  return { success: true }
}

export async function declineQuote(
  storeSlug: string,
  reservationId: string
) {
  const session = await getCustomerSession(storeSlug)
  if (!session) {
    return { error: 'errors.unauthorized' }
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
  })

  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id),
      eq(reservations.customerId, session.customerId)
    ),
    with: {
      customer: true,
    },
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  if (reservation.status !== 'quote') {
    return { error: 'errors.invalidStatus' }
  }

  // Move to declined
  await db
    .update(reservations)
    .set({ status: 'declined', updatedAt: new Date() })
    .where(eq(reservations.id, reservationId))

  // Log activity
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    activityType: 'quote_declined',
    metadata: { source: 'customer' },
    createdAt: new Date(),
  })

  // Notify the store owner
  dispatchNotification('reservation_cancelled', {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      discordWebhookUrl: store.discordWebhookUrl,
      ownerPhone: store.ownerPhone,
      notificationSettings: store.notificationSettings,
      settings: store.settings,
    },
    reservation: {
      id: reservationId,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: parseFloat(reservation.totalAmount),
    },
    customer: {
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone,
    },
  }).catch((error) => {
    console.error('Failed to dispatch quote declined notification:', error)
  })

  revalidatePath(`/${storeSlug}/account/reservations/${reservationId}`)
  return { success: true }
}

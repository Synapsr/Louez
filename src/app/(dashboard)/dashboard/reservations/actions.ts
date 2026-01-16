'use server'

import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getCurrentStore } from '@/lib/store-context'
import { reservations, reservationItems, customers, products, reservationActivity, payments } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import type { ReservationStatus } from '@/lib/validations/reservation'
import {
  sendRequestAcceptedEmail,
  sendRequestRejectedEmail,
  sendReservationConfirmationEmail,
  sendReminderPickupEmail,
  sendReminderReturnEmail,
} from '@/lib/email/send'
import { sendEmail } from '@/lib/email/client'
import { getContrastColorHex } from '@/lib/utils/colors'
import { getCurrencySymbol } from '@/lib/utils'
import {
  calculateRentalPrice,
  calculateDuration,
  generatePricingBreakdown,
  type PricingTier,
} from '@/lib/pricing'

async function getStoreForUser() {
  return getCurrentStore()
}

type ActivityType = 'created' | 'confirmed' | 'rejected' | 'cancelled' | 'picked_up' | 'returned' | 'note_updated' | 'payment_added' | 'payment_updated'

async function logReservationActivity(
  reservationId: string,
  activityType: ActivityType,
  description?: string,
  metadata?: Record<string, unknown>
) {
  const session = await auth()
  const userId = session?.user?.id || null

  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId,
    userId,
    activityType,
    description,
    metadata,
  })
}

async function generateReservationNumber(storeId: string): Promise<string> {
  const year = new Date().getFullYear()

  // Get count of reservations this year
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(reservations)
    .where(
      and(
        eq(reservations.storeId, storeId),
        sql`YEAR(${reservations.createdAt}) = ${year}`
      )
    )

  const count = result[0]?.count || 0
  const nextNumber = count + 1

  return `${year}-${String(nextNumber).padStart(4, '0')}`
}

export async function updateReservationStatus(
  reservationId: string,
  status: ReservationStatus,
  rejectionReason?: string
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
      items: true,
    },
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  const previousStatus = reservation.status
  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  }

  // Set timestamps based on status transition
  if (status === 'ongoing') {
    updateData.pickedUpAt = new Date()
  } else if (status === 'completed') {
    updateData.returnedAt = new Date()
  }

  await db
    .update(reservations)
    .set(updateData)
    .where(eq(reservations.id, reservationId))

  // Log activity based on status transition
  const activityMap: Record<string, ActivityType> = {
    confirmed: 'confirmed',
    rejected: 'rejected',
    ongoing: 'picked_up',
    completed: 'returned',
  }

  if (activityMap[status]) {
    await logReservationActivity(
      reservationId,
      activityMap[status],
      status === 'rejected' ? rejectionReason : undefined,
      { previousStatus, newStatus: status }
    )
  }

  // Send emails based on status change
  const storeData = {
    id: store.id,
    name: store.name,
    logoUrl: store.logoUrl,
    email: store.email,
    phone: store.phone,
    address: store.address,
    theme: store.theme,
  }

  const customerData = {
    firstName: reservation.customer.firstName,
    lastName: reservation.customer.lastName,
    email: reservation.customer.email,
  }

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
  const reservationUrl = `https://${store.slug}.${domain}/account/reservations/${reservationId}`

  // Send appropriate email
  // TODO: Use customer's stored locale preference when available
  const customerLocale = 'fr' as const

  if (previousStatus === 'pending' && status === 'confirmed') {
    // Request accepted - send acceptance email with items
    const emailItems = reservation.items.map((item) => ({
      name: item.productSnapshot?.name || 'Product',
      quantity: item.quantity,
      totalPrice: parseFloat(item.totalPrice),
    }))

    sendRequestAcceptedEmail({
      to: reservation.customer.email,
      store: storeData,
      customer: customerData,
      reservation: {
        id: reservationId,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: parseFloat(reservation.totalAmount),
      },
      items: emailItems,
      reservationUrl,
      paymentUrl: null, // TODO: Add payment URL when Stripe is integrated
      locale: customerLocale,
    }).catch((error) => {
      console.error('Failed to send request accepted email:', error)
    })
  } else if (status === 'rejected') {
    // Request rejected
    sendRequestRejectedEmail({
      to: reservation.customer.email,
      store: storeData,
      customer: customerData,
      reservation: {
        id: reservationId,
        number: reservation.number,
      },
      reason: rejectionReason,
      locale: customerLocale,
    }).catch((error) => {
      console.error('Failed to send request rejected email:', error)
    })
  }

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return { success: true }
}

export async function cancelReservation(reservationId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  if (['cancelled', 'completed', 'rejected'].includes(reservation.status || '')) {
    return { error: 'errors.cannotCancelReservation' }
  }

  await db
    .update(reservations)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  // Log activity
  await logReservationActivity(
    reservationId,
    'cancelled',
    undefined,
    { previousStatus: reservation.status }
  )

  // TODO: Send cancellation email to customer

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return { success: true }
}

export async function updateReservationNotes(
  reservationId: string,
  internalNotes: string
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  await db
    .update(reservations)
    .set({
      internalNotes,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservationId))

  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return { success: true }
}

interface CreateReservationData {
  customerId?: string
  newCustomer?: {
    email: string
    firstName: string
    lastName: string
    phone?: string
  }
  startDate: Date
  endDate: Date
  items: Array<{
    productId: string
    quantity: number
    priceOverride?: {
      unitPrice: number
    }
  }>
  customItems?: Array<{
    name: string
    description: string
    unitPrice: number
    deposit: number
    quantity: number
  }>
  internalNotes?: string
  sendConfirmationEmail?: boolean
}

export async function createManualReservation(data: CreateReservationData) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  let customerId = data.customerId

  // Create new customer if needed
  if (!customerId && data.newCustomer) {
    // Check if customer exists
    const existingCustomer = await db.query.customers.findFirst({
      where: and(
        eq(customers.storeId, store.id),
        eq(customers.email, data.newCustomer.email)
      ),
    })

    if (existingCustomer) {
      customerId = existingCustomer.id
    } else {
      const newCustomerId = nanoid()
      await db.insert(customers).values({
        id: newCustomerId,
        storeId: store.id,
        email: data.newCustomer.email,
        firstName: data.newCustomer.firstName,
        lastName: data.newCustomer.lastName,
        phone: data.newCustomer.phone || null,
      })
      customerId = newCustomerId
    }
  }

  if (!customerId) {
    return { error: 'errors.customerRequired' }
  }

  // Get store pricing mode
  const storePricingMode = store.settings?.pricingMode || 'day'

  // Calculate duration based on store pricing mode
  const duration = calculateDuration(data.startDate, data.endDate, storePricingMode)

  // Calculate totals
  let subtotalAmount = 0
  let depositAmount = 0

  // Process catalog products with pricing tiers
  const productDetails = await Promise.all(
    data.items.map(async (item) => {
      const product = await db.query.products.findFirst({
        where: and(
          eq(products.id, item.productId),
          eq(products.storeId, store.id)
        ),
        with: {
          pricingTiers: true,
        },
      })

      if (!product) {
        throw new Error(`errors.productNotFound`)
      }

      // Get effective pricing mode for this product
      const effectivePricingMode = product.pricingMode || storePricingMode

      // Convert pricing tiers to the expected format
      const tiers: PricingTier[] = (product.pricingTiers || []).map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: parseFloat(tier.discountPercent),
        displayOrder: tier.displayOrder || 0,
      }))

      // Calculate price with tiered pricing
      const pricing = {
        basePrice: parseFloat(product.price),
        deposit: parseFloat(product.deposit || '0'),
        pricingMode: effectivePricingMode,
        tiers,
      }

      const priceResult = calculateRentalPrice(pricing, duration, item.quantity)
      let pricingBreakdown = generatePricingBreakdown(priceResult, effectivePricingMode)

      // Check for price override
      const hasPriceOverride = !!item.priceOverride
      let effectiveUnitPrice = priceResult.effectivePricePerUnit
      let effectiveSubtotal = priceResult.subtotal

      if (hasPriceOverride) {
        effectiveUnitPrice = item.priceOverride!.unitPrice
        effectiveSubtotal = effectiveUnitPrice * duration * item.quantity

        // Update pricing breakdown to reflect the override
        pricingBreakdown = {
          ...pricingBreakdown,
          effectivePrice: effectiveUnitPrice,
          isManualOverride: true,
          originalPrice: priceResult.effectivePricePerUnit,
        }
      }

      subtotalAmount += effectiveSubtotal
      depositAmount += priceResult.deposit

      return {
        product,
        quantity: item.quantity,
        unitPrice: effectiveUnitPrice.toFixed(2),
        depositPerUnit: product.deposit || '0',
        totalPrice: effectiveSubtotal.toFixed(2),
        pricingBreakdown,
        isCustomItem: false,
      }
    })
  )

  // Process custom items (no tiered pricing for custom items)
  const customItemDetails = (data.customItems || []).map((item) => {
    const totalPrice = item.unitPrice * duration * item.quantity
    const totalDeposit = item.deposit * item.quantity

    subtotalAmount += totalPrice
    depositAmount += totalDeposit

    return {
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      depositPerUnit: item.deposit.toFixed(2),
      totalPrice: totalPrice.toFixed(2),
      isCustomItem: true,
    }
  })

  // Generate reservation number
  const reservationNumber = await generateReservationNumber(store.id)

  // Create reservation
  const reservationId = nanoid()
  await db.insert(reservations).values({
    id: reservationId,
    storeId: store.id,
    customerId,
    number: reservationNumber,
    status: 'confirmed', // Manual reservations are auto-confirmed
    startDate: data.startDate,
    endDate: data.endDate,
    subtotalAmount: subtotalAmount.toFixed(2),
    depositAmount: depositAmount.toFixed(2),
    totalAmount: subtotalAmount.toFixed(2),
    internalNotes: data.internalNotes || null,
    source: 'manual',
  })

  // Create reservation items for catalog products
  for (const detail of productDetails) {
    await db.insert(reservationItems).values({
      reservationId,
      productId: detail.product.id,
      isCustomItem: false,
      quantity: detail.quantity,
      unitPrice: detail.unitPrice,
      depositPerUnit: detail.depositPerUnit,
      totalPrice: detail.totalPrice,
      pricingBreakdown: detail.pricingBreakdown,
      productSnapshot: {
        name: detail.product.name,
        description: detail.product.description,
        images: detail.product.images || [],
      },
    })
  }

  // Create reservation items for custom items
  for (const customItem of customItemDetails) {
    await db.insert(reservationItems).values({
      reservationId,
      productId: null,
      isCustomItem: true,
      quantity: customItem.quantity,
      unitPrice: customItem.unitPrice,
      depositPerUnit: customItem.depositPerUnit,
      totalPrice: customItem.totalPrice,
      productSnapshot: {
        name: customItem.name,
        description: customItem.description,
        images: [],
      },
    })
  }

  // Log activity for manual reservation creation (auto-confirmed)
  await logReservationActivity(
    reservationId,
    'created',
    'Manual reservation created',
    { source: 'manual', status: 'confirmed' }
  )

  // Get customer info for email
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  })

  // Send confirmation email for manual reservations (if enabled)
  const shouldSendEmail = data.sendConfirmationEmail !== false
  if (customer && shouldSendEmail) {
    const storeData = {
      id: store.id,
      name: store.name,
      logoUrl: store.logoUrl,
      email: store.email,
      phone: store.phone,
      address: store.address,
      theme: store.theme,
    }

    const customerData = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
    }

    // Combine catalog products and custom items for email
    const emailItems = [
      ...productDetails.map((detail) => ({
        name: detail.product.name,
        quantity: detail.quantity,
        unitPrice: parseFloat(detail.unitPrice),
        totalPrice: parseFloat(detail.totalPrice),
      })),
      ...customItemDetails.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalPrice: parseFloat(item.totalPrice),
      })),
    ]

    const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
  const reservationUrl = `https://${store.slug}.${domain}/account/reservations/${reservationId}`

    // TODO: Use customer's stored locale preference when available
    sendReservationConfirmationEmail({
      to: customer.email,
      store: storeData,
      customer: customerData,
      reservation: {
        id: reservationId,
        number: reservationNumber,
        startDate: data.startDate,
        endDate: data.endDate,
        subtotalAmount,
        depositAmount,
        totalAmount: subtotalAmount,
      },
      items: emailItems,
      reservationUrl,
      locale: 'fr',
    }).catch((error) => {
      console.error('Failed to send reservation confirmation email:', error)
    })
  }

  revalidatePath('/dashboard/reservations')
  revalidatePath('/dashboard')
  return { success: true, reservationId }
}

export async function getReservation(reservationId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return null
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
      payments: true,
      documents: true,
    },
  })

  return reservation
}

export async function getStoreCustomers() {
  const store = await getStoreForUser()
  if (!store) {
    return []
  }

  return db.query.customers.findMany({
    where: eq(customers.storeId, store.id),
    orderBy: (customers, { desc }) => [desc(customers.createdAt)],
  })
}

export async function getStoreProducts() {
  const store = await getStoreForUser()
  if (!store) {
    return []
  }

  return db.query.products.findMany({
    where: and(eq(products.storeId, store.id), eq(products.status, 'active')),
    orderBy: (products, { asc }) => [asc(products.name)],
  })
}

// ============================================================================
// Payment Actions
// ============================================================================

export type PaymentType = 'rental' | 'deposit' | 'deposit_return' | 'damage'
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'check' | 'other'

interface RecordPaymentData {
  type: PaymentType
  amount: number
  method: PaymentMethod
  paidAt?: Date
  notes?: string
}

export async function recordPayment(
  reservationId: string,
  data: RecordPaymentData
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  if (data.amount <= 0) {
    return { error: 'errors.invalidAmount' }
  }

  const paymentId = nanoid()
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: data.amount.toFixed(2),
    type: data.type,
    method: data.method,
    status: 'completed',
    paidAt: data.paidAt || new Date(),
    notes: data.notes || null,
  })

  // Log activity
  const currencySymbol = getCurrencySymbol(store.settings?.currency || 'EUR')
  await logReservationActivity(
    reservationId,
    'payment_added',
    `${data.type === 'rental' ? 'Location' : data.type === 'deposit' ? 'Caution' : data.type === 'deposit_return' ? 'Restitution caution' : 'Dommages'}: ${data.amount.toFixed(2)}${currencySymbol} (${data.method})`,
    { paymentId, type: data.type, amount: data.amount, method: data.method }
  )

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return { success: true, paymentId }
}

export async function deletePayment(paymentId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Get payment with reservation to verify ownership
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
    with: {
      reservation: true,
    },
  })

  if (!payment || payment.reservation.storeId !== store.id) {
    return { error: 'errors.paymentNotFound' }
  }

  // Cannot delete Stripe payments
  if (payment.method === 'stripe') {
    return { error: 'errors.cannotDeleteStripePayment' }
  }

  await db.delete(payments).where(eq(payments.id, paymentId))

  // Log activity
  const currencySymbol = getCurrencySymbol(store.settings?.currency || 'EUR')
  await logReservationActivity(
    payment.reservationId,
    'payment_updated',
    `Paiement supprimé: ${parseFloat(payment.amount).toFixed(2)}${currencySymbol}`,
    { paymentId, type: payment.type, amount: payment.amount, action: 'deleted' }
  )

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${payment.reservationId}`)
  return { success: true }
}

interface ReturnDepositData {
  amount: number
  method: PaymentMethod
  notes?: string
}

export async function returnDeposit(
  reservationId: string,
  data: ReturnDepositData
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      payments: true,
    },
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  if (data.amount <= 0) {
    return { error: 'errors.invalidAmount' }
  }

  // Calculate how much deposit was collected
  const depositCollected = reservation.payments
    .filter((p) => p.type === 'deposit' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  // Calculate how much was already returned
  const depositReturned = reservation.payments
    .filter((p) => p.type === 'deposit_return' && p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.amount), 0)

  const maxReturnable = depositCollected - depositReturned

  if (data.amount > maxReturnable) {
    return { error: 'errors.amountExceedsDeposit' }
  }

  const paymentId = nanoid()
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: data.amount.toFixed(2),
    type: 'deposit_return',
    method: data.method,
    status: 'completed',
    paidAt: new Date(),
    notes: data.notes || null,
  })

  // Log activity
  const currencySymbol = getCurrencySymbol(store.settings?.currency || 'EUR')
  await logReservationActivity(
    reservationId,
    'payment_added',
    `Caution restituée: ${data.amount.toFixed(2)}${currencySymbol} (${data.method})`,
    { paymentId, type: 'deposit_return', amount: data.amount, method: data.method }
  )

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return { success: true, paymentId }
}

export async function recordDamage(
  reservationId: string,
  data: { amount: number; method: PaymentMethod; notes: string }
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  if (data.amount <= 0) {
    return { error: 'errors.invalidAmount' }
  }

  const paymentId = nanoid()
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: data.amount.toFixed(2),
    type: 'damage',
    method: data.method,
    status: 'completed',
    paidAt: new Date(),
    notes: data.notes,
  })

  // Log activity
  const currencySymbol = getCurrencySymbol(store.settings?.currency || 'EUR')
  await logReservationActivity(
    reservationId,
    'payment_added',
    `Frais de dommages: ${data.amount.toFixed(2)}${currencySymbol} - ${data.notes}`,
    { paymentId, type: 'damage', amount: data.amount, method: data.method }
  )

  revalidatePath('/dashboard/reservations')
  revalidatePath(`/dashboard/reservations/${reservationId}`)
  return { success: true, paymentId }
}

// ============================================================================
// Email Actions
// ============================================================================

interface SendReservationEmailData {
  templateId: string
  customSubject?: string
  customMessage?: string
}

export async function sendReservationEmail(
  reservationId: string,
  data: SendReservationEmailData
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
  })

  if (!reservation) {
    return { error: 'errors.reservationNotFound' }
  }

  const storeData = {
    id: store.id,
    name: store.name,
    logoUrl: store.logoUrl,
    email: store.email,
    phone: store.phone,
    address: store.address,
    theme: store.theme,
    emailSettings: store.emailSettings,
  }

  const customerData = {
    firstName: reservation.customer.firstName,
    lastName: reservation.customer.lastName,
    email: reservation.customer.email,
  }

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
  const reservationUrl = `https://${store.slug}.${domain}/account/reservations/${reservationId}`

  try {
    // Get button colors based on primary color contrast
    const primaryColor = store.theme?.primaryColor || '#0066FF'
    const buttonTextColor = getContrastColorHex(primaryColor)

    switch (data.templateId) {
      case 'contract': {
        // Send contract email with PDF attachment link
        const contractUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/reservations/${reservationId}/contract`
        const subject = data.customSubject || `Contrat de location #${reservation.number} - ${store.name}`
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bonjour ${customerData.firstName},</h2>
            <p>Veuillez trouver ci-joint le contrat de location pour votre réservation #${reservation.number}.</p>
            ${data.customMessage ? `<p>${data.customMessage}</p>` : ''}
            <p><a href="${contractUrl}" style="display: inline-block; background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Télécharger le contrat</a></p>
            <p>À bientôt,<br/>${store.name}</p>
          </div>
        `
        await sendEmail({ to: customerData.email, subject, html })
        break
      }

      case 'payment_request': {
        // Send payment request email
        const amountDue = parseFloat(reservation.totalAmount) + parseFloat(reservation.depositAmount)
        const currencySymbol = getCurrencySymbol(store.settings?.currency || 'EUR')
        const subject = data.customSubject || `Demande de paiement - Réservation #${reservation.number}`
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bonjour ${customerData.firstName},</h2>
            <p>Nous vous contactons concernant le paiement de votre réservation #${reservation.number}.</p>
            ${data.customMessage ? `<p>${data.customMessage}</p>` : ''}
            <p><strong>Montant total : ${amountDue.toFixed(2)}${currencySymbol}</strong></p>
            <p>Merci de procéder au règlement dans les meilleurs délais.</p>
            <p><a href="${reservationUrl}" style="display: inline-block; background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Voir ma réservation</a></p>
            <p>À bientôt,<br/>${store.name}</p>
          </div>
        `
        await sendEmail({ to: customerData.email, subject, html })
        break
      }

      case 'reminder_pickup': {
        // TODO: Use customer's stored locale preference when available
        await sendReminderPickupEmail({
          to: customerData.email,
          store: storeData,
          customer: customerData,
          reservation: {
            id: reservationId,
            number: reservation.number,
            startDate: reservation.startDate,
          },
          reservationUrl,
          locale: 'fr',
        })
        break
      }

      case 'reminder_return': {
        // TODO: Use customer's stored locale preference when available
        await sendReminderReturnEmail({
          to: customerData.email,
          store: storeData,
          customer: customerData,
          reservation: {
            id: reservationId,
            number: reservation.number,
            endDate: reservation.endDate,
          },
          locale: 'fr',
        })
        break
      }

      case 'custom': {
        if (!data.customMessage) {
          return { error: 'errors.messageRequired' }
        }
        const subject = data.customSubject || `À propos de votre réservation #${reservation.number} - ${store.name}`
        const html = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Bonjour ${customerData.firstName},</h2>
            <p>${data.customMessage.replace(/\n/g, '<br/>')}</p>
            <p><a href="${reservationUrl}" style="display: inline-block; background: ${primaryColor}; color: ${buttonTextColor}; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Voir ma réservation</a></p>
            <p>À bientôt,<br/>${store.name}</p>
          </div>
        `
        await sendEmail({ to: customerData.email, subject, html })
        break
      }

      default:
        return { error: 'errors.invalidEmailTemplate' }
    }

    // Log activity
    await logReservationActivity(
      reservationId,
      'note_updated',
      `Email envoyé: ${data.templateId}`,
      { templateId: data.templateId, to: customerData.email }
    )

    revalidatePath(`/dashboard/reservations/${reservationId}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to send reservation email:', error)
    return { error: 'errors.emailSendFailed' }
  }
}

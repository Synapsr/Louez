'use server'

import { db } from '@/lib/db'
import { customers, reservations, reservationItems, products, stores, storeMembers, users, payments, reservationActivity } from '@/lib/db/schema'
import { eq, and, inArray, lt, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ProductSnapshot } from '@/types'
import type { TaxSettings, ProductTaxSettings } from '@/types/store'
import {
  sendRequestReceivedEmail,
  sendNewRequestLandlordEmail,
} from '@/lib/email/send'
import { createCheckoutSession, toStripeCents } from '@/lib/stripe'
import { validateRentalPeriod } from '@/lib/utils/business-hours'
import { getMinStartDateTime, dateRangesOverlap } from '@/lib/utils/duration'
import { getEffectiveTaxRate, extractExclusiveFromInclusive, calculateTaxFromExclusive } from '@/lib/pricing/tax'

interface ReservationItem {
  productId: string
  quantity: number
  startDate: string
  endDate: string
  unitPrice: number
  depositPerUnit: number
  productSnapshot: ProductSnapshot
}

interface CreateReservationInput {
  storeId: string
  customer: {
    email: string
    firstName: string
    lastName: string
    phone?: string
    customerType?: 'individual' | 'business'
    companyName?: string
    address?: string
    city?: string
    postalCode?: string
  }
  items: ReservationItem[]
  customerNotes?: string
  subtotalAmount: number
  depositAmount: number
  totalAmount: number
  locale?: 'fr' | 'en'
}

async function generateUniqueReservationNumber(storeId: string, maxRetries = 5): Promise<string> {
  const date = new Date()
  const year = date.getFullYear().toString().slice(-2)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const prefix = `R${year}${month}-`

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Use crypto for better randomness
    const randomBytes = new Uint32Array(1)
    crypto.getRandomValues(randomBytes)
    const random = (randomBytes[0] % 10000).toString().padStart(4, '0')
    const number = `${prefix}${random}`

    // Check if this number already exists for this store
    const existing = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.storeId, storeId),
        eq(reservations.number, number)
      ),
    })

    if (!existing) {
      return number
    }
  }

  // If all retries failed, use timestamp + nanoid for guaranteed uniqueness
  const fallbackRandom = nanoid(6).toUpperCase()
  return `${prefix}${fallbackRandom}`
}

export async function createReservation(input: CreateReservationInput) {
  try {
    // Get store to validate business hours
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, input.storeId),
    })

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Calculate the overall rental period from items
    const itemStartDates = input.items.map((item) => new Date(item.startDate))
    const itemEndDates = input.items.map((item) => new Date(item.endDate))
    const rentalStartDate = new Date(Math.min(...itemStartDates.map((d) => d.getTime())))
    const rentalEndDate = new Date(Math.max(...itemEndDates.map((d) => d.getTime())))

    // Validate business hours for the rental period (using store's timezone for proper time comparison)
    const businessHoursValidation = validateRentalPeriod(
      rentalStartDate,
      rentalEndDate,
      store.settings?.businessHours,
      store.settings?.timezone
    )

    if (!businessHoursValidation.valid) {
      return {
        error: 'errors.businessHoursViolation',
        errorParams: { reasons: businessHoursValidation.errors.join(', ') },
      }
    }

    // Validate advance notice
    const advanceNoticeHours = store.settings?.advanceNotice || 0
    if (advanceNoticeHours > 0) {
      const minimumStartTime = getMinStartDateTime(advanceNoticeHours)
      if (rentalStartDate < minimumStartTime) {
        return {
          error: 'errors.advanceNoticeViolation',
          errorParams: { hours: advanceNoticeHours },
        }
      }
    }

    // Validate products exist and check stock
    for (const item of input.items) {
      const product = await db.query.products.findFirst({
        where: and(
          eq(products.id, item.productId),
          eq(products.storeId, input.storeId),
          eq(products.status, 'active')
        ),
      })

      if (!product) {
        return { error: 'errors.productUnavailable', errorParams: { name: item.productSnapshot.name } }
      }

      if (product.quantity < item.quantity) {
        return {
          error: 'errors.insufficientStock',
          errorParams: { name: item.productSnapshot.name, count: product.quantity },
        }
      }
    }

    // Check for date conflicts with existing reservations
    // This prevents race conditions where availability was checked earlier but changed since
    const pendingBlocksAvailability = store.settings?.pendingBlocksAvailability ?? true
    const blockingStatuses: ('pending' | 'confirmed' | 'ongoing')[] =
      pendingBlocksAvailability
        ? ['pending', 'confirmed', 'ongoing']
        : ['confirmed', 'ongoing']

    const overlappingReservations = await db.query.reservations.findMany({
      where: and(
        eq(reservations.storeId, input.storeId),
        inArray(reservations.status, blockingStatuses),
        lt(reservations.startDate, rentalEndDate),
        gt(reservations.endDate, rentalStartDate)
      ),
      with: {
        items: true,
      },
    })

    // Calculate reserved quantity per product for the requested period
    const reservedByProduct = new Map<string, number>()
    for (const reservation of overlappingReservations) {
      if (dateRangesOverlap(reservation.startDate, reservation.endDate, rentalStartDate, rentalEndDate)) {
        for (const resItem of reservation.items) {
          if (!resItem.productId) continue
          const current = reservedByProduct.get(resItem.productId) || 0
          reservedByProduct.set(resItem.productId, current + resItem.quantity)
        }
      }
    }

    // Check if requested quantities are still available
    for (const item of input.items) {
      const product = await db.query.products.findFirst({
        where: eq(products.id, item.productId),
      })
      if (!product) continue

      const reserved = reservedByProduct.get(item.productId) || 0
      const available = Math.max(0, product.quantity - reserved)

      if (item.quantity > available) {
        return {
          error: 'errors.productNoLongerAvailable',
          errorParams: { name: item.productSnapshot.name },
        }
      }
    }

    // Find or create customer
    let customer = await db.query.customers.findFirst({
      where: and(
        eq(customers.storeId, input.storeId),
        eq(customers.email, input.customer.email)
      ),
    })

    if (!customer) {
      const [newCustomer] = await db
        .insert(customers)
        .values({
          storeId: input.storeId,
          email: input.customer.email,
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
          customerType: input.customer.customerType || 'individual',
          companyName: input.customer.companyName || null,
          phone: input.customer.phone || null,
          address: input.customer.address || null,
          city: input.customer.city || null,
          postalCode: input.customer.postalCode || null,
          country: 'FR',
        })
        .$returningId()

      customer = await db.query.customers.findFirst({
        where: eq(customers.id, newCustomer.id),
      })
    } else {
      // Update customer info
      await db
        .update(customers)
        .set({
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
          customerType: input.customer.customerType || customer.customerType,
          companyName: input.customer.companyName ?? customer.companyName,
          phone: input.customer.phone || customer.phone,
          address: input.customer.address || customer.address,
          city: input.customer.city || customer.city,
          postalCode: input.customer.postalCode || customer.postalCode,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customer.id))
    }

    if (!customer) {
      return { error: 'errors.createCustomerError' }
    }

    // Find the earliest start date and latest end date from items
    const startDates = input.items.map((item) => new Date(item.startDate))
    const endDates = input.items.map((item) => new Date(item.endDate))
    const startDate = new Date(Math.min(...startDates.map((d) => d.getTime())))
    const endDate = new Date(Math.max(...endDates.map((d) => d.getTime())))

    // Get tax settings from store
    const storeTaxSettings = store.settings?.tax as TaxSettings | undefined
    const taxEnabled = storeTaxSettings?.enabled ?? false
    const storeTaxRate = storeTaxSettings?.defaultRate ?? 0
    const displayMode = storeTaxSettings?.displayMode ?? 'inclusive'

    // Calculate tax amounts for the reservation
    let subtotalExclTax: number | null = null
    let taxAmount: number | null = null
    let taxRate: number | null = null

    if (taxEnabled && storeTaxRate > 0) {
      taxRate = storeTaxRate
      if (displayMode === 'inclusive') {
        // Prices are TTC, extract HT
        subtotalExclTax = extractExclusiveFromInclusive(input.subtotalAmount, storeTaxRate)
        taxAmount = input.subtotalAmount - subtotalExclTax
      } else {
        // Prices are HT, calculate TVA
        subtotalExclTax = input.subtotalAmount
        taxAmount = calculateTaxFromExclusive(input.subtotalAmount, storeTaxRate)
      }
    }

    // Create reservation
    const reservationId = nanoid()
    const reservationNumber = await generateUniqueReservationNumber(input.storeId)

    await db.insert(reservations).values({
      id: reservationId,
      storeId: input.storeId,
      customerId: customer.id,
      number: reservationNumber,
      status: 'pending',
      startDate,
      endDate,
      subtotalAmount: input.subtotalAmount.toFixed(2),
      depositAmount: input.depositAmount.toFixed(2),
      totalAmount: input.totalAmount.toFixed(2),
      subtotalExclTax: subtotalExclTax?.toFixed(2) ?? null,
      taxAmount: taxAmount?.toFixed(2) ?? null,
      taxRate: taxRate?.toFixed(2) ?? null,
      customerNotes: input.customerNotes || null,
      source: 'online',
    })

    // Create reservation items with tax calculations
    for (const item of input.items) {
      const duration = calculateDuration(item.startDate, item.endDate)
      const totalPrice = item.unitPrice * item.quantity * duration

      // Get product tax settings
      const product = await db.query.products.findFirst({
        where: eq(products.id, item.productId),
      })
      const productTaxSettings = product?.taxSettings as ProductTaxSettings | undefined

      // Calculate item-level tax
      let itemTaxRate: number | null = null
      let itemTaxAmount: number | null = null
      let itemPriceExclTax: number | null = null
      let itemTotalExclTax: number | null = null

      if (taxEnabled) {
        // Get effective tax rate for this product
        const effectiveRate = getEffectiveTaxRate(
          { enabled: true, rate: storeTaxRate, displayMode },
          productTaxSettings
        )

        if (effectiveRate !== null && effectiveRate > 0) {
          itemTaxRate = effectiveRate
          if (displayMode === 'inclusive') {
            // Prices are TTC, extract HT
            itemPriceExclTax = extractExclusiveFromInclusive(item.unitPrice, effectiveRate)
            itemTotalExclTax = extractExclusiveFromInclusive(totalPrice, effectiveRate)
            itemTaxAmount = totalPrice - itemTotalExclTax
          } else {
            // Prices are HT, calculate TVA
            itemPriceExclTax = item.unitPrice
            itemTotalExclTax = totalPrice
            itemTaxAmount = calculateTaxFromExclusive(totalPrice, effectiveRate)
          }
        }
      }

      await db.insert(reservationItems).values({
        reservationId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        depositPerUnit: item.depositPerUnit.toFixed(2),
        totalPrice: totalPrice.toFixed(2),
        productSnapshot: item.productSnapshot,
        taxRate: itemTaxRate?.toFixed(2) ?? null,
        taxAmount: itemTaxAmount?.toFixed(2) ?? null,
        priceExclTax: itemPriceExclTax?.toFixed(2) ?? null,
        totalExclTax: itemTotalExclTax?.toFixed(2) ?? null,
      })
    }

    // Get store owner for fallback email
    const ownerMember = await db
      .select({ email: users.email })
      .from(storeMembers)
      .innerJoin(users, eq(storeMembers.userId, users.id))
      .where(and(
        eq(storeMembers.storeId, input.storeId),
        eq(storeMembers.role, 'owner')
      ))
      .limit(1)
      .then(res => res[0])

    // Send confirmation emails (non-blocking)
    if (store) {
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
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        email: input.customer.email,
        customerType: input.customer.customerType || 'individual',
        companyName: input.customer.companyName || null,
      }

      const reservationData = {
        id: reservationId,
        number: reservationNumber,
        startDate,
        endDate,
        totalAmount: input.totalAmount,
        // Tax info for emails
        taxEnabled,
        taxRate,
        subtotalExclTax,
        taxAmount,
      }

      // Send email to customer (request received) - use customer's locale
      sendRequestReceivedEmail({
        to: input.customer.email,
        store: storeData,
        customer: customerData,
        reservation: reservationData,
        locale: input.locale || 'fr',
      }).catch((error) => {
        console.error('Failed to send request received email:', error)
      })

      // Send email to landlord (new request notification) - always in French for landlord
      const landlordEmail = store.email || ownerMember?.email
      if (landlordEmail) {
        const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservationId}`
        sendNewRequestLandlordEmail({
          to: landlordEmail,
          store: storeData,
          customer: customerData,
          reservation: reservationData,
          dashboardUrl,
          locale: 'fr',
        }).catch((error) => {
          console.error('Failed to send new request landlord email:', error)
        })
      }
    }

    // Check if we should process payment via Stripe
    const shouldProcessPayment =
      store.settings?.reservationMode === 'payment' &&
      store.stripeAccountId &&
      store.stripeChargesEnabled

    let paymentUrl: string | null = null

    if (shouldProcessPayment) {
      try {
        const currency = store.settings?.currency || 'EUR'
        const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
        const protocol = domain.includes('localhost') ? 'http' : 'https'
        const baseUrl = `${protocol}://${store.slug}.${domain}`

        // Build line items for Stripe
        const lineItems = input.items.map((item) => ({
          name: item.productSnapshot.name,
          description: item.productSnapshot.description || undefined,
          quantity: item.quantity,
          unitAmount: toStripeCents(item.unitPrice * calculateDuration(item.startDate, item.endDate), currency),
        }))

        // Create checkout session
        const { url, sessionId } = await createCheckoutSession({
          stripeAccountId: store.stripeAccountId!,
          reservationId,
          reservationNumber,
          customerEmail: customer.email,
          lineItems,
          depositAmount: toStripeCents(input.depositAmount, currency),
          currency,
          successUrl: `${baseUrl}/checkout/success?reservation=${reservationId}`,
          cancelUrl: `${baseUrl}/checkout?cancelled=true`,
          locale: input.locale,
        })

        paymentUrl = url

        // Create a pending payment record to track the checkout session
        // This will be updated to 'completed' by the webhook when payment succeeds
        await db.insert(payments).values({
          id: nanoid(),
          reservationId,
          amount: input.subtotalAmount.toFixed(2),
          type: 'rental',
          method: 'stripe',
          status: 'pending',
          stripeCheckoutSessionId: sessionId,
          currency,
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        // Log payment initiated activity
        await db.insert(reservationActivity).values({
          id: nanoid(),
          reservationId,
          activityType: 'payment_initiated',
          description: null,
          metadata: {
            checkoutSessionId: sessionId,
            amount: input.subtotalAmount,
            currency,
            method: 'stripe',
          },
          createdAt: new Date(),
        })
      } catch (error) {
        console.error('Failed to create Stripe checkout session:', error)
        // Don't fail the reservation, store owner can send payment link manually
      }
    }

    return {
      success: true,
      reservationId,
      reservationNumber,
      paymentUrl,
    }
  } catch (error) {
    console.error('Error creating reservation:', error)
    return { error: 'errors.createReservationError' }
  }
}

// Duration calculation - uses Math.ceil (round up): any partial day = full day billed
function calculateDuration(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffMs = end.getTime() - start.getTime()
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

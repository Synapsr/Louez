'use server'

import { db } from '@/lib/db'
import { customers, reservations, reservationItems, products, stores, storeMembers, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ProductSnapshot } from '@/types'
import type { TaxSettings, ProductTaxSettings } from '@/types/store'
import {
  sendRequestReceivedEmail,
  sendNewRequestLandlordEmail,
} from '@/lib/email/send'
import { validateRentalPeriod } from '@/lib/utils/business-hours'
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

    // Validate business hours for the rental period
    const businessHoursValidation = validateRentalPeriod(
      rentalStartDate,
      rentalEndDate,
      store.settings?.businessHours
    )

    if (!businessHoursValidation.valid) {
      return {
        error: 'errors.businessHoursViolation',
        errorParams: { reasons: businessHoursValidation.errors.join(', ') },
      }
    }

    // Validate products exist and are available
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

    // For now, we don't have Stripe integration complete, so we just return success
    // In the future, if reservationMode is 'payment', we would create a Stripe checkout session
    return {
      success: true,
      reservationId,
      reservationNumber,
      paymentUrl: null as string | null,
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

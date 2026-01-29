'use server'

import { db } from '@/lib/db'
import { customers, reservations, reservationItems, products, stores, storeMembers, users, payments, reservationActivity } from '@/lib/db/schema'
import { eq, and, inArray, lt, gt } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ProductSnapshot } from '@/types'
import type { TaxSettings, ProductTaxSettings, StoreSettings } from '@/types/store'
import { sendNewRequestLandlordEmail } from '@/lib/email/send'
import { createCheckoutSession, toStripeCents } from '@/lib/stripe'
import { dispatchNotification } from '@/lib/notifications/dispatcher'
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher'
import { notifyNewReservation } from '@/lib/discord/platform-notifications'
import { getLocaleFromCountry } from '@/lib/email/i18n'
import { validateRentalPeriod } from '@/lib/utils/business-hours'
import { getMinStartDateTime, dateRangesOverlap } from '@/lib/utils/duration'
import { getMinRentalHours, getMaxRentalHours, validateMinRentalDuration, validateMaxRentalDuration } from '@/lib/utils/rental-duration'
import { getEffectiveTaxRate, extractExclusiveFromInclusive, calculateTaxFromExclusive } from '@/lib/pricing/tax'
import {
  calculateRentalPrice,
  calculateDuration as calcDuration,
  getEffectivePricingMode,
} from '@/lib/pricing/calculate'
import type { PricingMode } from '@/lib/pricing/types'
import { calculateHaversineDistance, calculateDeliveryFee, validateDelivery } from '@/lib/utils/geo'

interface ReservationItem {
  productId: string
  quantity: number
  startDate: string
  endDate: string
  unitPrice: number
  depositPerUnit: number
  productSnapshot: ProductSnapshot
}

interface DeliveryInput {
  option: 'pickup' | 'delivery'
  address?: string
  city?: string
  postalCode?: string
  country?: string
  latitude?: number
  longitude?: number
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
  delivery?: DeliveryInput
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

    // Validate minimum rental duration
    const minRentalHours = getMinRentalHours(store.settings as StoreSettings | null)
    if (minRentalHours > 0) {
      const durationCheck = validateMinRentalDuration(rentalStartDate, rentalEndDate, minRentalHours)
      if (!durationCheck.valid) {
        return {
          error: 'errors.minRentalDurationViolation',
          errorParams: { hours: minRentalHours },
        }
      }
    }

    // Validate maximum rental duration
    const maxRentalHours = getMaxRentalHours(store.settings as StoreSettings | null)
    if (maxRentalHours !== null) {
      const maxCheck = validateMaxRentalDuration(rentalStartDate, rentalEndDate, maxRentalHours)
      if (!maxCheck.valid) {
        return {
          error: 'errors.maxRentalDurationViolation',
          errorParams: { hours: maxRentalHours },
        }
      }
    }

    // ===== SERVER-SIDE PRICE CALCULATION =====
    // Never trust client-provided prices - always recalculate from database

    // Get store pricing mode
    const storeSettings = store.settings as StoreSettings | null
    const storePricingMode: PricingMode = storeSettings?.pricingMode || 'day'

    // Structure to hold server-calculated prices
    interface ServerCalculatedItem {
      productId: string
      quantity: number
      unitPrice: number // Server-calculated effective price per unit
      depositPerUnit: number // Server-calculated deposit
      subtotal: number // Server-calculated subtotal
      totalDeposit: number // Server-calculated total deposit
    }
    const serverCalculatedItems: ServerCalculatedItem[] = []
    let serverSubtotal = 0
    let serverTotalDeposit = 0

    // Validate products exist, check stock, and calculate prices from DB
    for (const item of input.items) {
      const product = await db.query.products.findFirst({
        where: and(
          eq(products.id, item.productId),
          eq(products.storeId, input.storeId),
          eq(products.status, 'active')
        ),
        with: {
          pricingTiers: true, // Get pricing tiers for this product
        },
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

      // Calculate price from database values (NOT from client input)
      const productPricingMode = getEffectivePricingMode(
        product.pricingMode as PricingMode | null,
        storePricingMode
      )
      const duration = calcDuration(item.startDate, item.endDate, productPricingMode)

      const pricingResult = calculateRentalPrice(
        {
          basePrice: Number(product.price),
          deposit: Number(product.deposit || 0),
          pricingMode: productPricingMode,
          tiers: product.pricingTiers?.map((t) => ({
            id: t.id,
            minDuration: t.minDuration,
            discountPercent: Number(t.discountPercent),
            displayOrder: t.displayOrder || 0,
          })) || [],
        },
        duration,
        item.quantity
      )

      serverCalculatedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: pricingResult.effectivePricePerUnit,
        depositPerUnit: Number(product.deposit || 0),
        subtotal: pricingResult.subtotal,
        totalDeposit: pricingResult.deposit,
      })

      serverSubtotal += pricingResult.subtotal
      serverTotalDeposit += pricingResult.deposit

      // Log price mismatch for monitoring (potential fraud attempt)
      const clientItemSubtotal = item.unitPrice * item.quantity * calculateDuration(item.startDate, item.endDate)
      if (Math.abs(clientItemSubtotal - pricingResult.subtotal) > 0.01) {
        console.warn('[SECURITY] Price mismatch detected', {
          productId: item.productId,
          clientSubtotal: clientItemSubtotal,
          serverSubtotal: pricingResult.subtotal,
          difference: clientItemSubtotal - pricingResult.subtotal,
        })
      }
    }

    const serverTotalAmount = serverSubtotal + serverTotalDeposit

    // ===== DELIVERY VALIDATION AND FEE CALCULATION =====
    let deliveryFee = 0
    let deliveryDistanceKm: number | null = null
    const deliverySettings = storeSettings?.delivery
    const deliveryMode = deliverySettings?.mode || 'optional'
    const isDeliveryForced = deliveryMode === 'required' || deliveryMode === 'included'
    const isDeliveryIncluded = deliveryMode === 'included'

    // Validate that delivery is selected when mode is forced
    if (isDeliveryForced && deliverySettings?.enabled && input.delivery?.option !== 'delivery') {
      return { error: 'errors.deliveryRequired' }
    }

    if (input.delivery?.option === 'delivery') {
      // Validate delivery is enabled for this store
      if (!deliverySettings?.enabled) {
        return { error: 'errors.deliveryNotEnabled' }
      }

      // Validate delivery address is provided
      if (!input.delivery.latitude || !input.delivery.longitude) {
        return { error: 'errors.deliveryAddressRequired' }
      }

      // Validate client coordinates are in valid range
      if (
        input.delivery.latitude < -90 ||
        input.delivery.latitude > 90 ||
        input.delivery.longitude < -180 ||
        input.delivery.longitude > 180
      ) {
        return { error: 'errors.deliveryAddressInvalid' }
      }

      // Validate store has coordinates for distance calculation
      if (!store.latitude || !store.longitude) {
        return { error: 'errors.storeCoordinatesNotConfigured' }
      }

      // Calculate distance from store to delivery address (server-side recalculation)
      const storeLatitude = parseFloat(store.latitude)
      const storeLongitude = parseFloat(store.longitude)

      // Validate parsed coordinates are valid numbers
      if (!isFinite(storeLatitude) || !isFinite(storeLongitude)) {
        return { error: 'errors.storeCoordinatesInvalid' }
      }

      // Validate store coordinate ranges
      if (
        storeLatitude < -90 ||
        storeLatitude > 90 ||
        storeLongitude < -180 ||
        storeLongitude > 180
      ) {
        return { error: 'errors.storeCoordinatesInvalid' }
      }

      deliveryDistanceKm = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        input.delivery.latitude,
        input.delivery.longitude
      )

      // Validate distance is within allowed range
      const deliveryValidation = validateDelivery(deliveryDistanceKm, deliverySettings)
      if (!deliveryValidation.valid) {
        return {
          error: deliveryValidation.errorKey || 'errors.deliveryTooFar',
          errorParams: deliveryValidation.errorParams,
        }
      }

      // Calculate delivery fee (server-side, never trust client)
      // If mode is 'included', fee is always 0
      deliveryFee = isDeliveryIncluded
        ? 0
        : calculateDeliveryFee(deliveryDistanceKm, deliverySettings, serverSubtotal)
    }

    // Add delivery fee to total
    const serverTotalWithDelivery = serverTotalAmount + deliveryFee

    // Log total mismatch for monitoring (include delivery fee in comparison)
    if (Math.abs(input.totalAmount - serverTotalWithDelivery) > 0.01) {
      console.warn('[SECURITY] Total amount mismatch detected', {
        clientTotal: input.totalAmount,
        serverTotal: serverTotalWithDelivery,
        clientSubtotal: input.subtotalAmount,
        serverSubtotal,
        clientDeposit: input.depositAmount,
        serverDeposit: serverTotalDeposit,
        serverDeliveryFee: deliveryFee,
      })
    }

    // Use server-calculated values for all monetary operations
    const finalSubtotal = serverSubtotal
    const finalDeposit = serverTotalDeposit
    const finalDeliveryFee = deliveryFee
    const finalTotal = serverTotalWithDelivery

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
          country: store.settings?.country || 'FR',
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

    // Calculate tax amounts for the reservation (using SERVER-CALCULATED values)
    let subtotalExclTax: number | null = null
    let taxAmount: number | null = null
    let taxRate: number | null = null

    if (taxEnabled && storeTaxRate > 0) {
      taxRate = storeTaxRate
      if (displayMode === 'inclusive') {
        // Prices are TTC, extract HT
        subtotalExclTax = extractExclusiveFromInclusive(finalSubtotal, storeTaxRate)
        taxAmount = finalSubtotal - subtotalExclTax
      } else {
        // Prices are HT, calculate TVA
        subtotalExclTax = finalSubtotal
        taxAmount = calculateTaxFromExclusive(finalSubtotal, storeTaxRate)
      }
    }

    // Create reservation with SERVER-CALCULATED amounts (never trust client)
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
      subtotalAmount: finalSubtotal.toFixed(2),
      depositAmount: finalDeposit.toFixed(2),
      totalAmount: finalTotal.toFixed(2),
      subtotalExclTax: subtotalExclTax?.toFixed(2) ?? null,
      taxAmount: taxAmount?.toFixed(2) ?? null,
      taxRate: taxRate?.toFixed(2) ?? null,
      customerNotes: input.customerNotes || null,
      source: 'online',
      // Delivery fields
      deliveryOption: input.delivery?.option || 'pickup',
      deliveryAddress: input.delivery?.option === 'delivery' ? input.delivery.address : null,
      deliveryCity: input.delivery?.option === 'delivery' ? input.delivery.city : null,
      deliveryPostalCode: input.delivery?.option === 'delivery' ? input.delivery.postalCode : null,
      deliveryCountry: input.delivery?.option === 'delivery' ? input.delivery.country : null,
      deliveryLatitude: input.delivery?.option === 'delivery' ? input.delivery.latitude?.toString() : null,
      deliveryLongitude: input.delivery?.option === 'delivery' ? input.delivery.longitude?.toString() : null,
      deliveryDistanceKm: deliveryDistanceKm?.toFixed(2) ?? null,
      deliveryFee: finalDeliveryFee.toFixed(2),
    })

    // Create reservation items with tax calculations (using SERVER-CALCULATED prices)
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]
      const serverItem = serverCalculatedItems[i]
      // Use server-calculated subtotal, not client-provided
      const totalPrice = serverItem.subtotal

      // Get product tax settings
      const product = await db.query.products.findFirst({
        where: eq(products.id, item.productId),
      })
      const productTaxSettings = product?.taxSettings as ProductTaxSettings | undefined

      // Calculate item-level tax (using server-calculated prices)
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
            // Prices are TTC, extract HT (using server-calculated prices)
            itemPriceExclTax = extractExclusiveFromInclusive(serverItem.unitPrice, effectiveRate)
            itemTotalExclTax = extractExclusiveFromInclusive(totalPrice, effectiveRate)
            itemTaxAmount = totalPrice - itemTotalExclTax
          } else {
            // Prices are HT, calculate TVA (using server-calculated prices)
            itemPriceExclTax = serverItem.unitPrice
            itemTotalExclTax = totalPrice
            itemTaxAmount = calculateTaxFromExclusive(totalPrice, effectiveRate)
          }
        }
      }

      // Use SERVER-CALCULATED prices, not client-provided
      await db.insert(reservationItems).values({
        reservationId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: serverItem.unitPrice.toFixed(2),
        depositPerUnit: serverItem.depositPerUnit.toFixed(2),
        totalPrice: totalPrice.toFixed(2),
        productSnapshot: item.productSnapshot,
        taxRate: itemTaxRate?.toFixed(2) ?? null,
        taxAmount: itemTaxAmount?.toFixed(2) ?? null,
        priceExclTax: itemPriceExclTax?.toFixed(2) ?? null,
        totalExclTax: itemTotalExclTax?.toFixed(2) ?? null,
      })
    }

    // Log activity for online reservation creation (by customer)
    await db.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: 'created',
      description: `${input.customer.firstName} ${input.customer.lastName}`,
      metadata: {
        source: 'online',
        status: 'pending',
        customerEmail: input.customer.email,
        customerName: `${input.customer.firstName} ${input.customer.lastName}`,
      },
      createdAt: new Date(),
    })

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
        darkLogoUrl: store.darkLogoUrl,
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

      // Use SERVER-CALCULATED amounts for all notifications
      const reservationData = {
        id: reservationId,
        number: reservationNumber,
        startDate,
        endDate,
        totalAmount: finalTotal,
        // Tax info for emails
        taxEnabled,
        taxRate,
        subtotalExclTax,
        taxAmount,
      }

      // Dispatch customer notification (email/SMS based on store preferences)
      dispatchCustomerNotification('customer_request_received', {
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
          id: customer.id,
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
          email: input.customer.email,
          phone: input.customer.phone,
        },
        reservation: {
          id: reservationId,
          number: reservationNumber,
          startDate,
          endDate,
          totalAmount: finalTotal,
          subtotalAmount: finalSubtotal,
          depositAmount: finalDeposit,
          taxEnabled,
          taxRate,
          subtotalExclTax,
          taxAmount,
        },
      }).catch((error: unknown) => {
        console.error('Failed to dispatch customer request received notification:', error)
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
          locale: getLocaleFromCountry(store.settings?.country),
        }).catch((error) => {
          console.error('Failed to send new request landlord email:', error)
        })
      }

      // Dispatch admin notifications (SMS, Discord) for new reservation
      dispatchNotification('reservation_new', {
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
          number: reservationNumber,
          startDate,
          endDate,
          totalAmount: finalTotal,
        },
        customer: {
          firstName: input.customer.firstName,
          lastName: input.customer.lastName,
          email: input.customer.email,
          phone: input.customer.phone,
        },
      }).catch((error) => {
        console.error('Failed to dispatch new reservation notification:', error)
      })

      // Platform admin notification
      notifyNewReservation(
        { id: store.id, name: store.name, slug: store.slug },
        {
          number: reservationNumber,
          customerName: `${input.customer.firstName} ${input.customer.lastName}`,
          totalAmount: finalTotal,
          currency: store.settings?.currency,
        }
      ).catch(() => {})
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

        // Get deposit percentage (default 100% = full payment)
        const depositPercentage = store.settings?.onlinePaymentDepositPercentage ?? 100
        const isPartialPayment = depositPercentage < 100

        // Calculate the amount to charge now
        // Round to 2 decimal places to avoid floating point issues
        const amountToCharge = isPartialPayment
          ? Math.round(finalSubtotal * depositPercentage) / 100
          : finalSubtotal

        // Ensure minimum Stripe amount (50 cents for most currencies)
        const MINIMUM_STRIPE_AMOUNT = 0.50
        const effectiveChargeAmount = Math.max(amountToCharge, MINIMUM_STRIPE_AMOUNT)
        // Don't exceed the full amount
        const finalChargeAmount = Math.min(effectiveChargeAmount, finalSubtotal)

        // Build line items for Stripe
        // For partial payments, create a single line item for the deposit
        // For full payments, itemize each product
        const lineItems = isPartialPayment
          ? [{
              name: `Acompte (${depositPercentage}%)`,
              description: `Acompte pour la réservation ${reservationNumber}`,
              quantity: 1,
              unitAmount: toStripeCents(finalChargeAmount, currency),
            }]
          : input.items.map((item, idx) => {
              const serverItem = serverCalculatedItems[idx]
              return {
                name: item.productSnapshot.name,
                description: item.productSnapshot.description || undefined,
                quantity: item.quantity,
                unitAmount: toStripeCents(serverItem.subtotal / item.quantity, currency),
              }
            })

        // Create checkout session
        const { url, sessionId } = await createCheckoutSession({
          stripeAccountId: store.stripeAccountId!,
          reservationId,
          reservationNumber,
          customerEmail: customer.email,
          lineItems,
          depositAmount: toStripeCents(finalDeposit, currency),
          currency,
          successUrl: `${baseUrl}/checkout/success?reservation=${reservationId}`,
          cancelUrl: `${baseUrl}/checkout?cancelled=true`,
          locale: input.locale,
        })

        paymentUrl = url

        // Create a pending payment record with the amount being charged
        await db.insert(payments).values({
          id: nanoid(),
          reservationId,
          amount: finalChargeAmount.toFixed(2),
          type: 'rental',
          method: 'stripe',
          status: 'pending',
          stripeCheckoutSessionId: sessionId,
          currency,
          notes: isPartialPayment ? `Acompte ${depositPercentage}%` : null,
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
            amount: finalChargeAmount,
            fullAmount: finalSubtotal,
            depositPercentage,
            isPartialPayment,
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

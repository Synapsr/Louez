/**
 * Reservations Generator
 *
 * Generates reservations with all possible states, items, and activity logs.
 */

import type { StoreConfig } from '../config'
import type { GeneratedProduct, GeneratedProductUnit } from './products'
import type { GeneratedCustomer } from './customers'
import {
  generateId,
  generateStripeId,
  generateReservationNumber,
  generateIpAddress,
  pickRandom,
  pickRandomMultiple,
  randomInt,
  randomDecimal,
  chance,
  weightedRandom,
  randomDate,
  addHours,
  addDays,
  addMinutes,
  setTime,
  startOfDay,
  isPast,
  logProgress,
} from '../utils'

export interface GeneratedReservation {
  id: string
  storeId: string
  customerId: string
  number: string
  status: 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  subtotalExclTax: string | null
  taxAmount: string | null
  taxRate: string | null
  signedAt: Date | null
  signatureIp: string | null
  depositStatus: 'none' | 'pending' | 'card_saved' | 'authorized' | 'captured' | 'released' | 'failed'
  depositPaymentIntentId: string | null
  depositAuthorizationExpiresAt: Date | null
  stripeCustomerId: string | null
  stripePaymentMethodId: string | null
  pickedUpAt: Date | null
  returnedAt: Date | null
  customerNotes: string | null
  internalNotes: string | null
  source: 'online' | 'phone' | 'inperson'
  createdAt: Date
  updatedAt: Date
}

export interface PricingBreakdownSeed {
  basePrice: number
  effectivePrice: number
  duration: number
  pricingMode: 'hour' | 'day' | 'week'
  discountPercent: number | null
  discountAmount: number
  tierApplied: string | null
  taxRate: number | null
  taxAmount: number | null
  subtotalExclTax: number | null
  subtotalInclTax: number | null
  isManualOverride?: boolean
  originalPrice?: number
}

export interface GeneratedReservationItem {
  id: string
  reservationId: string
  productId: string | null
  isCustomItem: boolean
  quantity: number
  unitPrice: string
  depositPerUnit: string
  totalPrice: string
  taxRate: string | null
  taxAmount: string | null
  priceExclTax: string | null
  totalExclTax: string | null
  pricingBreakdown: PricingBreakdownSeed | null
  productSnapshot: {
    name: string
    description: string | null
    images: string[]
  }
  createdAt: Date
}

export interface GeneratedReservationItemUnit {
  id: string
  reservationItemId: string
  productUnitId: string
  identifierSnapshot: string
  assignedAt: Date
}

export type ActivityType =
  | 'created'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'picked_up'
  | 'returned'
  | 'note_updated'
  | 'payment_added'
  | 'payment_updated'
  | 'payment_received'
  | 'payment_initiated'
  | 'payment_failed'
  | 'payment_expired'
  | 'deposit_authorized'
  | 'deposit_captured'
  | 'deposit_released'
  | 'deposit_failed'
  | 'access_link_sent'
  | 'modified'
  // Inspection events
  | 'inspection_departure_started'
  | 'inspection_departure_completed'
  | 'inspection_return_started'
  | 'inspection_return_completed'
  | 'inspection_damage_detected'
  | 'inspection_signed'

export interface GeneratedReservationActivity {
  id: string
  reservationId: string
  userId: string | null
  activityType: ActivityType
  description: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
}

export interface ReservationsGeneratorResult {
  reservations: GeneratedReservation[]
  reservationItems: GeneratedReservationItem[]
  reservationItemUnits: GeneratedReservationItemUnit[]
  reservationActivity: GeneratedReservationActivity[]
}

// Customer notes templates
const CUSTOMER_NOTES = [
  'Arrivée prévue vers 10h.',
  'Besoin de conseils pour les itinéraires.',
  'Premier séjour dans la région.',
  'Groupe familial avec 2 enfants.',
  'Sortie d\'entreprise.',
  'Anniversaire de mariage.',
  'Vacances d\'été.',
  'Week-end prolongé.',
  null,
  null,
  null,
]

// Internal notes templates
const INTERNAL_NOTES = {
  completed: [
    'Retour en bon état.',
    'Client très satisfait.',
    'Aucun problème signalé.',
    'Recommande un casque plus confortable.',
    null,
  ],
  damage: [
    'Rayure sur le cadre - usure normale.',
    'Crevaison arrière - réparé.',
    'Frein arrière à régler.',
    'Pédale légèrement tordue - impact mineur.',
  ],
  cancelled: [
    'Annulation pour raison personnelle.',
    'Changement de programme.',
    'Météo défavorable.',
    'Client a trouvé alternative.',
    null,
  ],
  rejected: [
    'Stock insuffisant pour ces dates.',
    'Dates non disponibles.',
    'Conflit avec maintenance prévue.',
    'Demande de dernière minute - délai trop court.',
  ],
}

/**
 * Determine reservation status based on dates and random distribution
 */
function determineReservationStatus(
  startDate: Date,
  endDate: Date,
  now: Date,
  storeConfig: StoreConfig
): {
  status: 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'
  depositStatus: 'none' | 'pending' | 'card_saved' | 'authorized' | 'captured' | 'released' | 'failed'
} {
  const isStartPast = startDate < now
  const isEndPast = endDate < now
  const isOngoing = isStartPast && !isEndPast

  // Cancelled/rejected can happen anytime
  if (chance(0.05)) {
    return { status: 'cancelled', depositStatus: chance(0.3) ? 'released' : 'none' }
  }
  if (storeConfig.reservationMode === 'request' && chance(0.03)) {
    return { status: 'rejected', depositStatus: 'none' }
  }

  // Past reservations
  if (isEndPast) {
    // 90% completed, 10% cancelled
    if (chance(0.9)) {
      // Completed: 85% released deposit, 15% captured (damage)
      const hasDamage = chance(0.15)
      return {
        status: 'completed',
        depositStatus: hasDamage ? 'captured' : 'released',
      }
    }
    return { status: 'cancelled', depositStatus: 'released' }
  }

  // Ongoing reservations
  if (isOngoing) {
    return { status: 'ongoing', depositStatus: 'authorized' }
  }

  // Future reservations
  // Request mode: mix of pending and confirmed
  if (storeConfig.reservationMode === 'request') {
    if (chance(0.3)) {
      return { status: 'pending', depositStatus: 'pending' }
    }
  }

  // Confirmed: deposit status varies
  const depositStatus = weightedRandom([
    { item: 'authorized' as const, weight: 0.6 },
    { item: 'pending' as const, weight: 0.2 },
    { item: 'card_saved' as const, weight: 0.1 },
    { item: 'none' as const, weight: 0.1 },
  ])

  return { status: 'confirmed', depositStatus }
}

/**
 * Calculate rental duration based on pricing mode
 */
function calculateDuration(
  startDate: Date,
  endDate: Date,
  pricingMode: 'hour' | 'day' | 'week'
): number {
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)

  switch (pricingMode) {
    case 'hour':
      return Math.ceil(diffHours)
    case 'day':
      return Math.ceil(diffHours / 24)
    case 'week':
      return Math.ceil(diffHours / (24 * 7))
  }
}

/**
 * Generate activity log for a reservation
 */
function generateActivityLog(
  reservationId: string,
  status: 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected',
  depositStatus: string,
  createdAt: Date,
  startDate: Date,
  endDate: Date,
  userId: string | null,
  storeConfig: StoreConfig
): GeneratedReservationActivity[] {
  const activities: GeneratedReservationActivity[] = []

  // Created
  activities.push({
    id: generateId(),
    reservationId,
    userId: null, // Customer action
    activityType: 'created',
    description: null,
    metadata: { source: 'online' },
    createdAt,
  })

  // Payment initiated (for payment mode)
  if (storeConfig.reservationMode === 'payment' && storeConfig.stripeEnabled) {
    activities.push({
      id: generateId(),
      reservationId,
      userId: null,
      activityType: 'payment_initiated',
      description: null,
      metadata: null,
      createdAt: addMinutes(createdAt, randomInt(1, 5)),
    })

    // Payment received (for completed flow)
    if (status !== 'pending') {
      activities.push({
        id: generateId(),
        reservationId,
        userId: null,
        activityType: 'payment_received',
        description: null,
        metadata: null,
        createdAt: addMinutes(createdAt, randomInt(5, 15)),
      })
    }
  }

  // Status-specific activities
  switch (status) {
    case 'confirmed':
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'confirmed',
        description: null,
        metadata: null,
        createdAt: addMinutes(createdAt, randomInt(30, 120)),
      })

      // Deposit authorized
      if (depositStatus === 'authorized') {
        activities.push({
          id: generateId(),
          reservationId,
          userId: null,
          activityType: 'deposit_authorized',
          description: null,
          metadata: null,
          createdAt: addHours(createdAt, randomInt(1, 24)),
        })
      }
      break

    case 'ongoing':
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'confirmed',
        description: null,
        metadata: null,
        createdAt: addMinutes(createdAt, randomInt(30, 120)),
      })
      activities.push({
        id: generateId(),
        reservationId,
        userId: null,
        activityType: 'deposit_authorized',
        description: null,
        metadata: null,
        createdAt: addHours(createdAt, randomInt(1, 24)),
      })
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'picked_up',
        description: null,
        metadata: null,
        createdAt: setTime(startDate, randomInt(9, 11)),
      })
      break

    case 'completed':
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'confirmed',
        description: null,
        metadata: null,
        createdAt: addMinutes(createdAt, randomInt(30, 120)),
      })
      activities.push({
        id: generateId(),
        reservationId,
        userId: null,
        activityType: 'deposit_authorized',
        description: null,
        metadata: null,
        createdAt: addHours(createdAt, randomInt(1, 24)),
      })
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'picked_up',
        description: null,
        metadata: null,
        createdAt: setTime(startDate, randomInt(9, 11)),
      })
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'returned',
        description: null,
        metadata: null,
        createdAt: setTime(endDate, randomInt(16, 18)),
      })

      // Deposit released or captured
      if (depositStatus === 'captured') {
        activities.push({
          id: generateId(),
          reservationId,
          userId,
          activityType: 'deposit_captured',
          description: pickRandom(INTERNAL_NOTES.damage),
          metadata: { amount: randomDecimal(20, 100) },
          createdAt: addHours(endDate, randomInt(1, 24)),
        })
      } else {
        activities.push({
          id: generateId(),
          reservationId,
          userId,
          activityType: 'deposit_released',
          description: null,
          metadata: null,
          createdAt: addHours(endDate, randomInt(1, 48)),
        })
      }
      break

    case 'cancelled':
      activities.push({
        id: generateId(),
        reservationId,
        userId: null, // Customer cancelled
        activityType: 'cancelled',
        description: pickRandom(INTERNAL_NOTES.cancelled),
        metadata: null,
        createdAt: addHours(createdAt, randomInt(1, 72)),
      })
      break

    case 'rejected':
      activities.push({
        id: generateId(),
        reservationId,
        userId,
        activityType: 'rejected',
        description: pickRandom(INTERNAL_NOTES.rejected),
        metadata: null,
        createdAt: addHours(createdAt, randomInt(1, 24)),
      })
      break
  }

  return activities
}

/**
 * Generate all reservations data for a store
 */
export function generateReservations(
  storeId: string,
  storeConfig: StoreConfig,
  products: GeneratedProduct[],
  productUnits: GeneratedProductUnit[],
  customers: GeneratedCustomer[],
  teamUserIds: string[],
  startDate: Date,
  endDate: Date,
  now: Date
): ReservationsGeneratorResult {
  const reservations: GeneratedReservation[] = []
  const reservationItems: GeneratedReservationItem[] = []
  const reservationItemUnits: GeneratedReservationItemUnit[] = []
  const reservationActivity: GeneratedReservationActivity[] = []

  // Filter active products only
  const activeProducts = products.filter((p) => p.status === 'active')
  if (activeProducts.length === 0 || customers.length === 0) {
    return { reservations, reservationItems, reservationItemUnits, reservationActivity }
  }

  // Build product units map
  const productUnitsMap = new Map<string, GeneratedProductUnit[]>()
  for (const unit of productUnits) {
    if (!productUnitsMap.has(unit.productId)) {
      productUnitsMap.set(unit.productId, [])
    }
    productUnitsMap.get(unit.productId)!.push(unit)
  }

  // Reservation counter for numbering
  let reservationCounter = 1

  for (let i = 0; i < storeConfig.reservationCount; i++) {
    // Pick a random customer
    const customer = pickRandom(customers)

    // Generate reservation dates
    const resStartDate = randomDate(startDate, endDate)
    // Set time to business hours (9-18)
    const adjustedStartDate = setTime(startOfDay(resStartDate), randomInt(9, 17))

    // Duration varies by pricing mode
    let durationHours: number
    switch (storeConfig.pricingMode) {
      case 'hour':
        durationHours = randomInt(2, 8)
        break
      case 'day':
        durationHours = randomInt(1, 7) * 24
        break
      case 'week':
        durationHours = randomInt(1, 3) * 7 * 24
        break
    }

    const resEndDate = addHours(adjustedStartDate, durationHours)

    // Determine status based on dates
    const { status, depositStatus } = determineReservationStatus(
      adjustedStartDate,
      resEndDate,
      now,
      storeConfig
    )

    // Pick 1-3 products
    const numProducts = weightedRandom([
      { item: 1, weight: 0.5 },
      { item: 2, weight: 0.35 },
      { item: 3, weight: 0.15 },
    ])
    const selectedProducts = pickRandomMultiple(activeProducts, numProducts)

    // Calculate totals
    let subtotal = 0
    let totalDeposit = 0
    const duration = calculateDuration(adjustedStartDate, resEndDate, storeConfig.pricingMode)

    const reservationId = generateId()
    const createdAt = new Date(adjustedStartDate.getTime() - randomInt(1, 14) * 24 * 60 * 60 * 1000)
    const userId = teamUserIds.length > 0 ? pickRandom(teamUserIds) : null

    // Generate items
    for (const product of selectedProducts) {
      const quantity = randomInt(1, Math.min(3, product.quantity))
      const unitPrice = parseFloat(product.price)
      const depositPerUnit = parseFloat(product.deposit)

      // Apply simple tiered pricing (just for seed data, not exact)
      const totalPrice = unitPrice * duration * quantity
      const itemDeposit = depositPerUnit * quantity

      subtotal += totalPrice
      totalDeposit += itemDeposit

      const itemId = generateId()

      // Tax calculation if enabled
      let taxRate: string | null = null
      let taxAmount: string | null = null
      let priceExclTax: string | null = null
      let totalExclTax: string | null = null

      if (storeConfig.taxEnabled) {
        taxRate = storeConfig.taxRate.toFixed(2)
        if (storeConfig.taxMode === 'inclusive') {
          // Price includes tax
          const rate = storeConfig.taxRate / 100
          priceExclTax = (unitPrice / (1 + rate)).toFixed(2)
          totalExclTax = (totalPrice / (1 + rate)).toFixed(2)
          taxAmount = (totalPrice - parseFloat(totalExclTax)).toFixed(2)
        } else {
          // Price excludes tax
          priceExclTax = unitPrice.toFixed(2)
          totalExclTax = totalPrice.toFixed(2)
          taxAmount = (totalPrice * (storeConfig.taxRate / 100)).toFixed(2)
        }
      }

      reservationItems.push({
        id: itemId,
        reservationId,
        productId: product.id,
        isCustomItem: false,
        quantity,
        unitPrice: unitPrice.toFixed(2),
        depositPerUnit: depositPerUnit.toFixed(2),
        totalPrice: totalPrice.toFixed(2),
        taxRate,
        taxAmount,
        priceExclTax,
        totalExclTax,
        pricingBreakdown: {
          basePrice: unitPrice,
          effectivePrice: unitPrice,
          duration,
          pricingMode: storeConfig.pricingMode,
          discountPercent: null,
          discountAmount: 0,
          tierApplied: null,
          taxRate: storeConfig.taxEnabled ? storeConfig.taxRate : null,
          taxAmount: taxAmount ? parseFloat(taxAmount) : null,
          subtotalExclTax: totalExclTax ? parseFloat(totalExclTax) : null,
          subtotalInclTax: totalPrice,
        },
        productSnapshot: {
          name: product.name,
          description: product.description,
          images: product.images,
        },
        createdAt,
      })

      // Assign product units if tracking is enabled and reservation is ongoing/completed
      if (product.trackUnits && ['ongoing', 'completed'].includes(status)) {
        const availableUnits = productUnitsMap.get(product.id)?.filter((u) => u.status === 'available') || []

        const unitsToAssign = availableUnits.slice(0, quantity)
        for (const unit of unitsToAssign) {
          reservationItemUnits.push({
            id: generateId(),
            reservationItemId: itemId,
            productUnitId: unit.id,
            identifierSnapshot: unit.identifier,
            assignedAt: adjustedStartDate,
          })
        }
      }
    }

    // Calculate tax totals
    let subtotalExclTax: string | null = null
    let totalTaxAmount: string | null = null

    if (storeConfig.taxEnabled) {
      if (storeConfig.taxMode === 'inclusive') {
        const rate = storeConfig.taxRate / 100
        subtotalExclTax = (subtotal / (1 + rate)).toFixed(2)
        totalTaxAmount = (subtotal - parseFloat(subtotalExclTax)).toFixed(2)
      } else {
        subtotalExclTax = subtotal.toFixed(2)
        totalTaxAmount = (subtotal * (storeConfig.taxRate / 100)).toFixed(2)
        subtotal = subtotal + parseFloat(totalTaxAmount) // Add tax to total
      }
    }

    // Source distribution
    const source = weightedRandom([
      { item: 'online' as const, weight: 0.7 },
      { item: 'phone' as const, weight: 0.2 },
      { item: 'inperson' as const, weight: 0.1 },
    ])

    // Signature for confirmed+ reservations
    const shouldSign = ['confirmed', 'ongoing', 'completed'].includes(status)
    const signedAt = shouldSign ? addMinutes(createdAt, randomInt(5, 30)) : null
    const signatureIp = shouldSign ? generateIpAddress() : null

    // Pickup and return times
    let pickedUpAt: Date | null = null
    let returnedAt: Date | null = null

    if (['ongoing', 'completed'].includes(status)) {
      pickedUpAt = setTime(adjustedStartDate, randomInt(9, 11))
    }
    if (status === 'completed') {
      returnedAt = setTime(resEndDate, randomInt(16, 18))
    }

    // Stripe IDs for online payments
    const hasStripe = storeConfig.stripeEnabled && source === 'online'
    const stripeCustomerId = hasStripe ? generateStripeId('cus') : null
    const stripePaymentMethodId = hasStripe && depositStatus !== 'none' ? generateStripeId('pm') : null
    const depositPaymentIntentId =
      hasStripe && ['authorized', 'captured', 'released'].includes(depositStatus)
        ? generateStripeId('pi')
        : null

    // Deposit authorization expiry (7 days after creation for active holds)
    const depositAuthorizationExpiresAt =
      depositStatus === 'authorized' ? addDays(createdAt, 7) : null

    // Notes
    const customerNotes = chance(0.3) ? pickRandom(CUSTOMER_NOTES) : null
    let internalNotes: string | null = null

    if (status === 'completed' && depositStatus === 'captured') {
      internalNotes = pickRandom(INTERNAL_NOTES.damage)
    } else if (status === 'completed') {
      internalNotes = pickRandom(INTERNAL_NOTES.completed)
    } else if (status === 'cancelled') {
      internalNotes = pickRandom(INTERNAL_NOTES.cancelled)
    } else if (status === 'rejected') {
      internalNotes = pickRandom(INTERNAL_NOTES.rejected)
    }

    reservations.push({
      id: reservationId,
      storeId,
      customerId: customer.id,
      number: generateReservationNumber(reservationCounter++),
      status,
      startDate: adjustedStartDate,
      endDate: resEndDate,
      subtotalAmount: subtotal.toFixed(2),
      depositAmount: totalDeposit.toFixed(2),
      totalAmount: (subtotal + totalDeposit).toFixed(2),
      subtotalExclTax,
      taxAmount: totalTaxAmount,
      taxRate: storeConfig.taxEnabled ? storeConfig.taxRate.toFixed(2) : null,
      signedAt,
      signatureIp,
      depositStatus,
      depositPaymentIntentId,
      depositAuthorizationExpiresAt,
      stripeCustomerId,
      stripePaymentMethodId,
      pickedUpAt,
      returnedAt,
      customerNotes,
      internalNotes,
      source,
      createdAt,
      updatedAt: now,
    })

    // Generate activity log
    const activities = generateActivityLog(
      reservationId,
      status,
      depositStatus,
      createdAt,
      adjustedStartDate,
      resEndDate,
      userId,
      storeConfig
    )
    reservationActivity.push(...activities)

    logProgress(i + 1, storeConfig.reservationCount, `Reservations for ${storeConfig.name}`)
  }

  return {
    reservations,
    reservationItems,
    reservationItemUnits,
    reservationActivity,
  }
}

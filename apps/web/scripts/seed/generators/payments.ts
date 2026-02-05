/**
 * Payments Generator
 *
 * Generates payment records for reservations with various types, methods, and statuses.
 */

import type { StoreConfig } from '../config'
import type { GeneratedReservation } from './reservations'
import {
  generateId,
  generateStripeId,
  pickRandom,
  randomInt,
  randomDecimal,
  chance,
  weightedRandom,
  addMinutes,
  addHours,
  addDays,
} from '../utils'

export interface GeneratedPayment {
  id: string
  reservationId: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_hold' | 'deposit_capture' | 'deposit_return' | 'damage' | 'adjustment'
  method: 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
  status: 'pending' | 'authorized' | 'completed' | 'failed' | 'cancelled' | 'refunded'
  stripePaymentIntentId: string | null
  stripeChargeId: string | null
  stripeCheckoutSessionId: string | null
  stripeRefundId: string | null
  stripePaymentMethodId: string | null
  authorizationExpiresAt: Date | null
  capturedAmount: string | null
  currency: string
  notes: string | null
  paidAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Payment notes templates
 */
const PAYMENT_NOTES = {
  rental: [
    'Paiement reçu via Stripe',
    'Paiement en ligne - confirmation automatique',
    'Paiement au comptoir',
    null,
  ],
  cash: [
    'Espèces - compte exact',
    'Espèces - rendu monnaie effectué',
    'Paiement cash à la récupération',
    null,
  ],
  damage: [
    'Dommage constaté au retour - rayure cadre',
    'Crevaison non signalée',
    'Accessoire manquant',
    'Frais de nettoyage',
    'Retard de retour - pénalité',
  ],
  adjustment: [
    'Remise fidélité client',
    'Geste commercial',
    'Erreur de tarification corrigée',
    'Remise groupe',
  ],
}

/**
 * Generate payments for a reservation based on its status
 */
function generatePaymentsForReservation(
  reservation: GeneratedReservation,
  storeConfig: StoreConfig,
  now: Date
): GeneratedPayment[] {
  const payments: GeneratedPayment[] = []
  const isStripeEnabled = storeConfig.stripeEnabled && reservation.source === 'online'

  // Determine payment method based on source
  let primaryMethod: 'stripe' | 'cash' | 'card' | 'transfer' | 'check' | 'other'
  if (isStripeEnabled) {
    primaryMethod = 'stripe'
  } else {
    primaryMethod = weightedRandom([
      { item: 'cash' as const, weight: 0.4 },
      { item: 'card' as const, weight: 0.35 },
      { item: 'transfer' as const, weight: 0.15 },
      { item: 'check' as const, weight: 0.1 },
    ])
  }

  const subtotal = parseFloat(reservation.subtotalAmount)
  const deposit = parseFloat(reservation.depositAmount)

  // For pending reservations, might have no payment yet
  if (reservation.status === 'pending') {
    if (storeConfig.reservationMode === 'payment' && isStripeEnabled) {
      // Payment initiated but not completed
      payments.push({
        id: generateId(),
        reservationId: reservation.id,
        amount: subtotal.toFixed(2),
        type: 'rental',
        method: 'stripe',
        status: 'pending',
        stripePaymentIntentId: generateStripeId('pi'),
        stripeChargeId: null,
        stripeCheckoutSessionId: generateStripeId('cs'),
        stripeRefundId: null,
        stripePaymentMethodId: null,
        authorizationExpiresAt: null,
        capturedAmount: null,
        currency: 'EUR',
        notes: null,
        paidAt: null,
        createdAt: reservation.createdAt,
        updatedAt: now,
      })
    }
    return payments
  }

  // Cancelled/rejected reservations might have refunds
  if (reservation.status === 'cancelled' || reservation.status === 'rejected') {
    // Some cancelled reservations had payments that were refunded
    if (chance(0.3) && isStripeEnabled) {
      const paidAt = addMinutes(reservation.createdAt, randomInt(5, 30))

      payments.push({
        id: generateId(),
        reservationId: reservation.id,
        amount: subtotal.toFixed(2),
        type: 'rental',
        method: 'stripe',
        status: 'refunded',
        stripePaymentIntentId: generateStripeId('pi'),
        stripeChargeId: generateStripeId('ch'),
        stripeCheckoutSessionId: generateStripeId('cs'),
        stripeRefundId: generateStripeId('re'),
        stripePaymentMethodId: generateStripeId('pm'),
        authorizationExpiresAt: null,
        capturedAmount: null,
        currency: 'EUR',
        notes: 'Remboursement suite à annulation',
        paidAt,
        createdAt: reservation.createdAt,
        updatedAt: now,
      })
    }
    return payments
  }

  // Active reservations (confirmed, ongoing, completed)

  // 1. Main rental payment
  const rentalPaidAt = addMinutes(reservation.createdAt, randomInt(5, 30))

  // Check for partial payment mode
  const isPartialPayment =
    storeConfig.onlinePaymentDepositPercentage < 100 && isStripeEnabled

  if (isPartialPayment) {
    const partialAmount = (subtotal * storeConfig.onlinePaymentDepositPercentage) / 100
    const remainingAmount = subtotal - partialAmount

    // First payment (deposit percentage)
    payments.push({
      id: generateId(),
      reservationId: reservation.id,
      amount: partialAmount.toFixed(2),
      type: 'rental',
      method: 'stripe',
      status: 'completed',
      stripePaymentIntentId: generateStripeId('pi'),
      stripeChargeId: generateStripeId('ch'),
      stripeCheckoutSessionId: generateStripeId('cs'),
      stripeRefundId: null,
      stripePaymentMethodId: generateStripeId('pm'),
      authorizationExpiresAt: null,
      capturedAmount: null,
      currency: 'EUR',
      notes: `Acompte ${storeConfig.onlinePaymentDepositPercentage}%`,
      paidAt: rentalPaidAt,
      createdAt: reservation.createdAt,
      updatedAt: now,
    })

    // Remaining payment (if completed)
    if (reservation.status === 'completed') {
      const remainingPaidAt = reservation.pickedUpAt || rentalPaidAt

      payments.push({
        id: generateId(),
        reservationId: reservation.id,
        amount: remainingAmount.toFixed(2),
        type: 'rental',
        method: primaryMethod === 'stripe' ? pickRandom(['cash', 'card']) : primaryMethod,
        status: 'completed',
        stripePaymentIntentId: null,
        stripeChargeId: null,
        stripeCheckoutSessionId: null,
        stripeRefundId: null,
        stripePaymentMethodId: null,
        authorizationExpiresAt: null,
        capturedAmount: null,
        currency: 'EUR',
        notes: 'Solde payé à la récupération',
        paidAt: remainingPaidAt,
        createdAt: new Date(remainingPaidAt.getTime() - 60000),
        updatedAt: now,
      })
    } else {
      // Pending remaining payment
      payments.push({
        id: generateId(),
        reservationId: reservation.id,
        amount: remainingAmount.toFixed(2),
        type: 'rental',
        method: 'other',
        status: 'pending',
        stripePaymentIntentId: null,
        stripeChargeId: null,
        stripeCheckoutSessionId: null,
        stripeRefundId: null,
        stripePaymentMethodId: null,
        authorizationExpiresAt: null,
        capturedAmount: null,
        currency: 'EUR',
        notes: 'Solde à payer à la récupération',
        paidAt: null,
        createdAt: reservation.createdAt,
        updatedAt: now,
      })
    }
  } else {
    // Full payment upfront
    payments.push({
      id: generateId(),
      reservationId: reservation.id,
      amount: subtotal.toFixed(2),
      type: 'rental',
      method: primaryMethod,
      status: 'completed',
      stripePaymentIntentId: isStripeEnabled ? generateStripeId('pi') : null,
      stripeChargeId: isStripeEnabled ? generateStripeId('ch') : null,
      stripeCheckoutSessionId: isStripeEnabled ? generateStripeId('cs') : null,
      stripeRefundId: null,
      stripePaymentMethodId: isStripeEnabled ? generateStripeId('pm') : null,
      authorizationExpiresAt: null,
      capturedAmount: null,
      currency: 'EUR',
      notes: pickRandom(primaryMethod === 'cash' ? PAYMENT_NOTES.cash : PAYMENT_NOTES.rental),
      paidAt: rentalPaidAt,
      createdAt: reservation.createdAt,
      updatedAt: now,
    })
  }

  // 2. Deposit handling (if deposit > 0)
  if (deposit > 0 && reservation.depositStatus !== 'none') {
    const depositCreatedAt = addHours(reservation.createdAt, randomInt(1, 24))

    switch (reservation.depositStatus) {
      case 'pending':
      case 'card_saved':
        // Deposit hold not yet created
        payments.push({
          id: generateId(),
          reservationId: reservation.id,
          amount: deposit.toFixed(2),
          type: 'deposit_hold',
          method: 'stripe',
          status: 'pending',
          stripePaymentIntentId: generateStripeId('pi'),
          stripeChargeId: null,
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
          stripePaymentMethodId: reservation.stripePaymentMethodId,
          authorizationExpiresAt: null,
          capturedAmount: null,
          currency: 'EUR',
          notes: 'En attente de confirmation caution',
          paidAt: null,
          createdAt: depositCreatedAt,
          updatedAt: now,
        })
        break

      case 'authorized':
        // Active hold
        payments.push({
          id: generateId(),
          reservationId: reservation.id,
          amount: deposit.toFixed(2),
          type: 'deposit_hold',
          method: 'stripe',
          status: 'authorized',
          stripePaymentIntentId: reservation.depositPaymentIntentId || generateStripeId('pi'),
          stripeChargeId: null,
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
          stripePaymentMethodId: reservation.stripePaymentMethodId,
          authorizationExpiresAt: reservation.depositAuthorizationExpiresAt || addDays(depositCreatedAt, 7),
          capturedAmount: null,
          currency: 'EUR',
          notes: 'Empreinte bancaire active',
          paidAt: null,
          createdAt: depositCreatedAt,
          updatedAt: now,
        })
        break

      case 'captured':
        // Deposit was captured (damage)
        const capturedAmount = parseFloat(randomDecimal(20, Math.min(deposit, 150)))

        payments.push({
          id: generateId(),
          reservationId: reservation.id,
          amount: deposit.toFixed(2),
          type: 'deposit_hold',
          method: 'stripe',
          status: 'completed',
          stripePaymentIntentId: reservation.depositPaymentIntentId || generateStripeId('pi'),
          stripeChargeId: generateStripeId('ch'),
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
          stripePaymentMethodId: reservation.stripePaymentMethodId,
          authorizationExpiresAt: null,
          capturedAmount: capturedAmount.toFixed(2),
          currency: 'EUR',
          notes: 'Caution capturée suite à dommage',
          paidAt: reservation.returnedAt ? addHours(reservation.returnedAt, randomInt(1, 24)) : now,
          createdAt: depositCreatedAt,
          updatedAt: now,
        })

        // Damage payment record
        payments.push({
          id: generateId(),
          reservationId: reservation.id,
          amount: capturedAmount.toFixed(2),
          type: 'damage',
          method: 'stripe',
          status: 'completed',
          stripePaymentIntentId: null,
          stripeChargeId: null,
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
          stripePaymentMethodId: null,
          authorizationExpiresAt: null,
          capturedAmount: null,
          currency: 'EUR',
          notes: pickRandom(PAYMENT_NOTES.damage),
          paidAt: reservation.returnedAt ? addHours(reservation.returnedAt, randomInt(1, 24)) : now,
          createdAt: reservation.returnedAt || now,
          updatedAt: now,
        })

        // If partial capture, return the rest
        if (capturedAmount < deposit) {
          payments.push({
            id: generateId(),
            reservationId: reservation.id,
            amount: (deposit - capturedAmount).toFixed(2),
            type: 'deposit_return',
            method: 'stripe',
            status: 'completed',
            stripePaymentIntentId: null,
            stripeChargeId: null,
            stripeCheckoutSessionId: null,
            stripeRefundId: generateStripeId('re'),
            stripePaymentMethodId: null,
            authorizationExpiresAt: null,
            capturedAmount: null,
            currency: 'EUR',
            notes: 'Remboursement partiel caution',
            paidAt: reservation.returnedAt ? addHours(reservation.returnedAt, randomInt(24, 48)) : now,
            createdAt: reservation.returnedAt || now,
            updatedAt: now,
          })
        }
        break

      case 'released':
        // Hold was released (no damage)
        payments.push({
          id: generateId(),
          reservationId: reservation.id,
          amount: deposit.toFixed(2),
          type: 'deposit_hold',
          method: 'stripe',
          status: 'cancelled',
          stripePaymentIntentId: reservation.depositPaymentIntentId || generateStripeId('pi'),
          stripeChargeId: null,
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
          stripePaymentMethodId: reservation.stripePaymentMethodId,
          authorizationExpiresAt: null,
          capturedAmount: null,
          currency: 'EUR',
          notes: 'Caution libérée - aucun dommage',
          paidAt: null,
          createdAt: depositCreatedAt,
          updatedAt: now,
        })
        break

      case 'failed':
        // Authorization failed
        payments.push({
          id: generateId(),
          reservationId: reservation.id,
          amount: deposit.toFixed(2),
          type: 'deposit_hold',
          method: 'stripe',
          status: 'failed',
          stripePaymentIntentId: generateStripeId('pi'),
          stripeChargeId: null,
          stripeCheckoutSessionId: null,
          stripeRefundId: null,
          stripePaymentMethodId: null,
          authorizationExpiresAt: null,
          capturedAmount: null,
          currency: 'EUR',
          notes: 'Échec autorisation - carte refusée',
          paidAt: null,
          createdAt: depositCreatedAt,
          updatedAt: now,
        })
        break
    }
  }

  // 3. Occasional adjustments (5% of completed reservations)
  if (reservation.status === 'completed' && chance(0.05)) {
    const adjustmentAmount = parseFloat(randomDecimal(-20, -5))

    payments.push({
      id: generateId(),
      reservationId: reservation.id,
      amount: adjustmentAmount.toFixed(2),
      type: 'adjustment',
      method: 'other',
      status: 'completed',
      stripePaymentIntentId: null,
      stripeChargeId: null,
      stripeCheckoutSessionId: null,
      stripeRefundId: null,
      stripePaymentMethodId: null,
      authorizationExpiresAt: null,
      capturedAmount: null,
      currency: 'EUR',
      notes: pickRandom(PAYMENT_NOTES.adjustment),
      paidAt: reservation.returnedAt || now,
      createdAt: reservation.returnedAt || now,
      updatedAt: now,
    })
  }

  return payments
}

/**
 * Generate all payments for a list of reservations
 */
export function generatePayments(
  reservations: GeneratedReservation[],
  storeConfig: StoreConfig,
  now: Date
): GeneratedPayment[] {
  const payments: GeneratedPayment[] = []

  for (const reservation of reservations) {
    const reservationPayments = generatePaymentsForReservation(reservation, storeConfig, now)
    payments.push(...reservationPayments)
  }

  return payments
}

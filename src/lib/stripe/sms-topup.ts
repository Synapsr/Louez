/**
 * SMS Top-up Stripe Integration
 *
 * Handles one-time payments for SMS credit purchases.
 * Pricing is based on the store's current plan:
 * - Pro: 0.15€ per SMS
 * - Ultra: 0.07€ per SMS
 * - Start: Not allowed to top-up
 */

import { stripe } from './client'
import { db } from '@/lib/db'
import { stores, smsTopupTransactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { SMS_TOPUP_PRICING, type SmsTopupPackage } from '@/lib/plans'
import { getStorePlan } from '@/lib/plan-limits'
import { getOrCreateStripeCustomer } from './subscriptions'

export interface CreateSmsTopupCheckoutOptions {
  storeId: string
  quantity: SmsTopupPackage
  successUrl: string
  cancelUrl: string
  translations: {
    productName: string
    productDescription: string
  }
}

export interface SmsTopupCheckoutResult {
  sessionId: string
  url: string | null
}

/**
 * Get the SMS top-up price per SMS for a store based on its plan
 * Returns null if the store cannot top-up (Start plan)
 */
export async function getSmsTopupPrice(storeId: string): Promise<{
  canTopup: boolean
  priceCents: number | null
  planSlug: string
}> {
  const plan = await getStorePlan(storeId)
  const priceCents = SMS_TOPUP_PRICING[plan.slug] ?? null

  return {
    canTopup: priceCents !== null,
    priceCents,
    planSlug: plan.slug,
  }
}

/**
 * Create a Stripe Checkout session for SMS top-up purchase
 */
export async function createSmsTopupCheckoutSession({
  storeId,
  quantity,
  successUrl,
  cancelUrl,
  translations,
}: CreateSmsTopupCheckoutOptions): Promise<SmsTopupCheckoutResult> {
  // Validate store exists
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
  })

  if (!store) {
    throw new Error('Store not found')
  }

  // Check if store can top-up based on plan
  const { canTopup, priceCents, planSlug } = await getSmsTopupPrice(storeId)

  if (!canTopup || priceCents === null) {
    throw new Error('SMS top-up not available for your plan')
  }

  // Calculate total
  const totalAmountCents = quantity * priceCents

  // Get or create Stripe customer (persisted to DB to avoid duplicates on abandoned checkouts)
  const stripeCustomerId = await getOrCreateStripeCustomer(storeId)

  // Create pending transaction record
  const transactionId = nanoid()
  await db.insert(smsTopupTransactions).values({
    id: transactionId,
    storeId,
    quantity,
    unitPriceCents: priceCents,
    totalAmountCents,
    currency: 'eur',
    status: 'pending',
  })

  // Format price for display
  const unitPriceEuros = (priceCents / 100).toFixed(2).replace('.', ',')
  const planName = planSlug.charAt(0).toUpperCase() + planSlug.slice(1)

  // Create the checkout session with translated product info
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: translations.productName
              .replace('{quantity}', quantity.toString()),
            description: translations.productDescription
              .replace('{quantity}', quantity.toString())
              .replace('{price}', unitPriceEuros)
              .replace('{plan}', planName),
          },
          unit_amount: priceCents,
        },
        quantity: quantity,
      },
    ],
    metadata: {
      type: 'sms_topup',
      storeId,
      transactionId,
      quantity: quantity.toString(),
      unitPriceCents: priceCents.toString(),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Allow updating existing customer's info during checkout
    customer_update: {
      name: 'auto',
      address: 'auto',
    },
  })

  // Update transaction with Stripe session ID
  await db
    .update(smsTopupTransactions)
    .set({ stripeSessionId: session.id })
    .where(eq(smsTopupTransactions.id, transactionId))

  return {
    sessionId: session.id,
    url: session.url,
  }
}

/**
 * Get top-up transaction by Stripe session ID
 */
export async function getTopupTransactionBySessionId(sessionId: string) {
  return db.query.smsTopupTransactions.findFirst({
    where: eq(smsTopupTransactions.stripeSessionId, sessionId),
  })
}

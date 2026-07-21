/**
 * AI advisor credit top-up — one-off Stripe purchases on the PLATFORM customer.
 *
 * Credit packs (amounts and prices) come entirely from env (`AI_CREDIT_PACKAGES`),
 * never hardcoded, so the repo reveals no commercial figures. The card is saved
 * off-session on the first purchase so the merchant can later enable auto-top-up
 * without a separate card-capture flow.
 */

import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { aiCreditTransactions, db, stores } from '@louez/db'

import { creditsToMicro } from '@/lib/ai/advisor/credits'
import { getAiCreditPackages, type AiCreditPackage } from '@/lib/plans'

import { stripe } from './client'
import { getOrCreateStripeCustomer } from './subscriptions'

export interface CreateAiCreditTopupOptions {
  storeId: string
  pack: AiCreditPackage
  successUrl: string
  cancelUrl: string
  translations: {
    productName: string // may contain "{credits}"
    productDescription: string // may contain "{credits}"
  }
}

export interface AiCreditTopupCheckoutResult {
  sessionId: string
  url: string | null
}

/** Whether a requested pack matches one the platform actually sells (env). */
function resolvePack(pack: AiCreditPackage): AiCreditPackage | null {
  return (
    getAiCreditPackages().find(
      (p) => p.credits === pack.credits && p.priceCents === pack.priceCents,
    ) ?? null
  )
}

/**
 * Create a Stripe Checkout session to purchase a credit pack. Records a pending
 * transaction first; the webhook credits the balance on payment.
 */
export async function createAiCreditTopupCheckoutSession({
  storeId,
  pack,
  successUrl,
  cancelUrl,
  translations,
}: CreateAiCreditTopupOptions): Promise<AiCreditTopupCheckoutResult> {
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (!store) {
    throw new Error('Store not found')
  }

  const valid = resolvePack(pack)
  if (!valid) {
    throw new Error('Invalid AI credit package')
  }

  const stripeCustomerId = await getOrCreateStripeCustomer(storeId)

  const transactionId = nanoid()
  await db.insert(aiCreditTransactions).values({
    id: transactionId,
    storeId,
    type: 'topup',
    creditsMicro: creditsToMicro(valid.credits),
    amountCents: valid.priceCents,
    currency: 'eur',
    status: 'pending',
  })

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: translations.productName.replace(
              '{credits}',
              String(valid.credits),
            ),
            description: translations.productDescription.replace(
              '{credits}',
              String(valid.credits),
            ),
          },
          unit_amount: valid.priceCents,
        },
        quantity: 1,
      },
    ],
    // Save the card off-session so the merchant can enable auto-top-up later
    // without building a separate card-capture flow.
    payment_intent_data: { setup_future_usage: 'off_session' },
    metadata: {
      type: 'ai_credit_topup',
      storeId,
      transactionId,
      credits: String(valid.credits),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_update: {
      name: 'auto',
      address: 'auto',
    },
  })

  await db
    .update(aiCreditTransactions)
    .set({ stripeSessionId: session.id })
    .where(eq(aiCreditTransactions.id, transactionId))

  return { sessionId: session.id, url: session.url }
}

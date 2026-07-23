import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { aiCreditTransactions, aiCredits, db } from '@louez/db'

import { creditsToMicro } from '@/lib/ai/advisor/credits'
import { log } from '@/lib/evlog'
import { stripe } from '@/lib/stripe/client'
import {
  getOrCreateStripeCustomer,
  storeHasDefaultPaymentMethod,
} from '@/lib/stripe/subscriptions'

/**
 * Off-session auto-top-up: when a store's prepaid balance drops below its
 * configured threshold, charge a saved card via a Stripe Invoice. Crediting is
 * reconciled on the invoice.paid webhook (never here), so a charge that fails or
 * is retried by Stripe dunning grants credits exactly once.
 *
 * Idempotent per hour via a UNIQUE dedup key, so repeated calls (one per model
 * run while the balance is low) never fire more than one charge per window.
 */
export async function maybeTriggerAutoTopup(storeId: string): Promise<void> {
  try {
    const row = await db.query.aiCredits.findFirst({
      where: eq(aiCredits.storeId, storeId),
    })
    if (
      !row ||
      !row.autoTopupEnabled ||
      !row.autoTopupCredits ||
      !row.autoTopupPriceCents ||
      row.autoTopupThresholdMicro == null
    ) {
      return
    }
    // Only act once the balance has actually dropped below the threshold.
    if (row.balanceMicro >= row.autoTopupThresholdMicro) return

    const credits = row.autoTopupCredits
    const priceCents = row.autoTopupPriceCents
    const window = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
    const dedupKey = `auto:${storeId}:${window}`
    const transactionId = nanoid()

    // Claim this attempt. A duplicate dedup key means an attempt already fired
    // this hour — back off rather than charge again.
    try {
      await db.insert(aiCreditTransactions).values({
        id: transactionId,
        storeId,
        type: 'auto_topup',
        creditsMicro: creditsToMicro(credits),
        amountCents: priceCents,
        currency: 'eur',
        dedupKey,
        status: 'pending',
      })
    } catch {
      return
    }

    // Off-session charging needs a saved card.
    if (!(await storeHasDefaultPaymentMethod(storeId))) {
      await db
        .update(aiCreditTransactions)
        .set({ status: 'failed' })
        .where(eq(aiCreditTransactions.id, transactionId))
      return
    }

    const customerId = await getOrCreateStripeCustomer(storeId)

    // Create the invoice FIRST, excluding any stray pending items on the shared
    // platform customer, then bind a single line item to THIS invoice — so the
    // charge can never sweep in unrelated items (referral credits, prorations…).
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: 'charge_automatically',
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        metadata: { type: 'ai_credit_topup', storeId, transactionId },
      },
      { idempotencyKey: `ai_topup_${transactionId}` },
    )
    if (!invoice.id) {
      throw new Error('Stripe invoice creation returned no id')
    }
    await db
      .update(aiCreditTransactions)
      .set({ stripeInvoiceId: invoice.id })
      .where(eq(aiCreditTransactions.id, transactionId))

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: priceCents,
      currency: 'eur',
      description: `AI credits — ${credits}`,
    })

    // Finalizing a charge_automatically invoice attempts payment immediately;
    // the invoice.paid / invoice.payment_failed webhook does the crediting.
    await stripe.invoices.finalizeInvoice(invoice.id)
  } catch (error) {
    log.error(
      'advisor',
      `auto-topup failed for ${storeId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

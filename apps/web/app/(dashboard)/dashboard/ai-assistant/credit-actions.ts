'use server'

import { revalidatePath } from 'next/cache'

import { env } from '@/env'
import { updateAutoTopupConfig } from '@/lib/ai/advisor/credits'
import { areAiCreditsEnabled, getAiCreditPackages } from '@/lib/plans'
import { createAiCreditTopupCheckoutSession } from '@/lib/stripe/ai-credit-topup'
import { getCurrentStore } from '@/lib/store-context'

// Stripe line-item labels per locale (hardcoded to avoid i18n caching issues,
// mirroring the SMS top-up). `{credits}` is substituted at checkout.
const STRIPE_TRANSLATIONS: Record<
  string,
  { productName: string; productDescription: string }
> = {
  fr: {
    productName: 'Crédits IA — {credits} crédits',
    productDescription: 'Recharge de {credits} crédits pour le conseiller IA',
  },
  en: {
    productName: 'AI credits — {credits} credits',
    productDescription: 'Top-up of {credits} credits for the AI advisor',
  },
  de: {
    productName: 'KI-Guthaben — {credits} Credits',
    productDescription: 'Aufladung von {credits} Credits für den KI-Berater',
  },
  es: {
    productName: 'Créditos IA — {credits} créditos',
    productDescription: 'Recarga de {credits} créditos para el asesor IA',
  },
  it: {
    productName: 'Crediti IA — {credits} crediti',
    productDescription: 'Ricarica di {credits} crediti per il consulente IA',
  },
  nl: {
    productName: 'AI-tegoed — {credits} credits',
    productDescription: 'Opwaardering van {credits} credits voor de AI-adviseur',
  },
  pl: {
    productName: 'Kredyty AI — {credits} kredytów',
    productDescription: 'Doładowanie {credits} kredytów dla doradcy AI',
  },
  pt: {
    productName: 'Créditos IA — {credits} créditos',
    productDescription: 'Recarga de {credits} créditos para o consultor de IA',
  },
}

/** Start a Stripe Checkout to buy a credit pack (by index into the env packages). */
export async function createAiCreditTopupCheckout(
  packIndex: number,
  locale: string,
  returnPath?: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const store = await getCurrentStore()
  if (!store) {
    return { success: false, error: 'errors.unauthorized' }
  }
  if (!areAiCreditsEnabled()) {
    return { success: false, error: 'errors.featureNotAvailable' }
  }

  const pack = getAiCreditPackages()[packIndex]
  if (!pack) {
    return { success: false, error: 'errors.invalidPackage' }
  }

  const translations = STRIPE_TRANSLATIONS[locale] || STRIPE_TRANSLATIONS.fr

  // Return to the page the recharge was launched from. Restricted to internal
  // dashboard paths so the checkout redirect can never be pointed off-site.
  const safeReturn =
    returnPath && returnPath.startsWith('/dashboard/')
      ? returnPath
      : '/dashboard/ai-assistant'

  // Build the return URLs safely so an existing query string in the path can't
  // produce a malformed `?a=b?topup=…`.
  const successUrl = new URL(`${env.NEXT_PUBLIC_APP_URL}${safeReturn}`)
  successUrl.searchParams.set('topup', 'success')
  const cancelUrl = new URL(`${env.NEXT_PUBLIC_APP_URL}${safeReturn}`)
  cancelUrl.searchParams.set('topup', 'cancelled')

  try {
    const result = await createAiCreditTopupCheckoutSession({
      storeId: store.id,
      pack,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      translations,
    })
    return { success: true, url: result.url || undefined }
  } catch (error) {
    console.error('Failed to create AI credit top-up checkout:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'errors.checkoutFailed',
    }
  }
}

/** Enable/disable and configure off-session auto-top-up for the current store. */
export async function updateAiCreditsAutoTopup(config: {
  enabled: boolean
  thresholdCredits: number
  packIndex: number
}): Promise<{ success?: boolean; error?: string }> {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }
  if (!areAiCreditsEnabled()) {
    return { error: 'errors.featureNotAvailable' }
  }

  const pack = getAiCreditPackages()[config.packIndex]
  if (config.enabled && !pack) {
    return { error: 'errors.invalidPackage' }
  }

  await updateAutoTopupConfig(store.id, {
    enabled: config.enabled,
    thresholdCredits: Math.max(0, Math.trunc(config.thresholdCredits)),
    credits: pack?.credits ?? 0,
    priceCents: pack?.priceCents ?? 0,
  })

  revalidatePath('/dashboard/ai-assistant')
  return { success: true }
}

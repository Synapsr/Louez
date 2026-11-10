'use server'

import { revalidatePath } from 'next/cache'

import { isApiError } from '@louez/api/platform/errors'
import { logProviderError } from '@louez/api/platform/sanitize-error'
import { createDashboardUrl } from '@louez/api/adapters/stripe-connect'
import {
  requireConnectClient,
  startConnectOnboarding,
  writeConnectColumns,
} from '@louez/api/services/stripe-connect'

import { apiPorts } from '@/lib/api/ports'
import { getCurrentStore, hasPermission } from '@/lib/store-context'
import { sanitizeStripeNextPath, stripeReturnUrls } from './stripe-return'

// The dashboard's own Stripe Connect flows: they send the browser to Stripe
// directly. An agent gets the same steps as handoff links
// (packages/api routers/dashboard/payments.ts); both go through
// services/stripe-connect.ts.

/** The dashboard's translation key of an API error, or `fallback`. */
const errorKey = (error: unknown, fallback: string) =>
  isApiError(error) && error.data.i18nKey ? error.data.i18nKey : fallback

/**
 * Start Stripe Connect onboarding
 * Creates a new Standard account if needed and returns the onboarding URL.
 * `options.next` (allowlisted) sends the user there after the Stripe return
 * instead of the settings callback screen — used by the onboarding flow.
 */
export async function startStripeOnboarding(options?: {
  next?: string
}): Promise<{
  url?: string
  error?: string
}> {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    return { error: 'errors.permissionDenied' }
  }

  try {
    const { returnUrl, refreshUrl } = stripeReturnUrls(sanitizeStripeNextPath(options?.next))
    const { url } = await startConnectOnboarding({
      client: requireConnectClient(apiPorts),
      store,
      urls: apiPorts.urls,
      returnUrl,
      refreshUrl,
    })
    revalidatePath('/dashboard/settings/payments')
    return { url }
  } catch (error) {
    return { error: errorKey(error, 'errors.stripe.onboardingFailed') }
  }
}

/**
 * Get Stripe dashboard link (Express login link, or the hosted dashboard for Standard)
 */
export async function getStripeDashboardUrl(): Promise<{
  url?: string
  error?: string
}> {
  const store = await getCurrentStore()

  if (!store || !store.stripeAccountId) {
    return { error: 'errors.noStripeAccount' }
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    return { error: 'errors.permissionDenied' }
  }

  try {
    const url = await createDashboardUrl(requireConnectClient(apiPorts), store.stripeAccountId)
    return { url }
  } catch (error) {
    logProviderError('Stripe dashboard link error', error)
    return { error: 'errors.stripe.dashboardLinkFailed' }
  }
}

/**
 * Disconnect Stripe account
 */
export async function disconnectStripe(): Promise<{
  success?: boolean
  error?: string
}> {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    return { error: 'errors.permissionDenied' }
  }

  // Note: We don't delete the Stripe account, just unlink it
  await writeConnectColumns(store.id, {
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripeOnboardingComplete: false,
  })

  revalidatePath('/dashboard/settings/payments')
  revalidatePath('/dashboard/settings')

  return { success: true }
}

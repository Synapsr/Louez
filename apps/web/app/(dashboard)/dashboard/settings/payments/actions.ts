'use server'

import { db } from '@louez/db'
import { stores } from '@louez/db'
import { users } from '@louez/db'
import { isStripeConfigured } from '@/lib/plans'
import { getCurrentStore } from '@/lib/store-context'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  RENTAL_MCC,
  createConnectAccount,
  createAccountLink,
  createAccountLoginLink,
  getAccountStatus,
  toStatementDescriptor,
} from '@/lib/stripe'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { sanitizeStripeNextPath, stripeReturnUrls } from './stripe-return'

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
  if (!isStripeConfigured()) {
    return { error: 'errors.stripeNotConfigured' }
  }

  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  try {
    let accountId = store.stripeAccountId
    const storeCountry = (store.settings?.country || 'FR').toUpperCase()

    // If already has an active account, return error
    if (accountId && store.stripeChargesEnabled) {
      return { error: 'errors.stripe.alreadyConnected' }
    }

    // A Stripe account's country is immutable. If the store country changed
    // since a pending (not yet chargeable) account was created, abandon it
    // and start over — its KYC progress targets the wrong country anyway.
    if (accountId) {
      const { country } = await getAccountStatus(accountId)
      if (country && country.toUpperCase() !== storeCountry) {
        accountId = null
      }
    }

    // Create new account if needed
    if (!accountId) {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, store.userId),
        columns: { email: true },
      })
      const accountEmail = (store.email || owner?.email || '').trim()

      if (!accountEmail) {
        return { error: 'errors.email' }
      }

      // Prefill the KYC's business-details step with what we already know.
      // Stripe only accepts publicly reachable https URLs, so skip the
      // storefront URL on localhost dev environments.
      const storefrontUrl = getStorefrontUrl(store.slug)
      const httpsStorefrontUrl = storefrontUrl.startsWith('https://')
        ? storefrontUrl
        : undefined
      const description = store.description?.trim()

      const account = await createConnectAccount({
        email: accountEmail,
        country: storeCountry,
        businessProfile: {
          name: store.name,
          mcc: RENTAL_MCC,
          url: httpsStorefrontUrl,
          productDescription: description ? description.slice(0, 500) : undefined,
          supportEmail: accountEmail,
          supportPhone: store.phone?.trim() || undefined,
          supportUrl: httpsStorefrontUrl,
        },
        statementDescriptor: toStatementDescriptor(store.name),
        metadata: {
          storeId: store.id,
          storeName: store.name,
        },
      })
      accountId = account.id

      // Save account ID
      await db
        .update(stores)
        .set({
          stripeAccountId: accountId,
          updatedAt: new Date(),
        })
        .where(eq(stores.id, store.id))
    }

    // Create onboarding link
    const { returnUrl, refreshUrl } = stripeReturnUrls(
      sanitizeStripeNextPath(options?.next)
    )
    const url = await createAccountLink(accountId, returnUrl, refreshUrl)

    revalidatePath('/dashboard/settings/payments')
    return { url }
  } catch (error) {
    console.error('Stripe onboarding error:', error)
    return { error: 'errors.stripe.onboardingFailed' }
  }
}

/**
 * Complete Stripe onboarding after return from Stripe
 * Syncs the account status
 */
export async function completeStripeOnboarding(): Promise<{
  success?: boolean
  status?: {
    chargesEnabled: boolean
    detailsSubmitted: boolean
    requirementsCount: number
  }
  error?: string
}> {
  const store = await getCurrentStore()

  if (!store || !store.stripeAccountId) {
    return { error: 'errors.unauthorized' }
  }

  try {
    const status = await getAccountStatus(store.stripeAccountId)

    // Update store with latest status
    await db
      .update(stores)
      .set({
        stripeChargesEnabled: status.chargesEnabled,
        stripeOnboardingComplete: status.chargesEnabled && status.detailsSubmitted,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/payments')
    revalidatePath('/dashboard/settings')

    return {
      success: true,
      status: {
        chargesEnabled: status.chargesEnabled,
        detailsSubmitted: status.detailsSubmitted,
        requirementsCount: status.requirements.currentlyDue.length,
      },
    }
  } catch (error) {
    console.error('Stripe completion error:', error)
    return { error: 'errors.stripe.verificationFailed' }
  }
}

/**
 * Sync Stripe account status
 */
export async function syncStripeStatus(): Promise<{
  success?: boolean
  chargesEnabled?: boolean
  error?: string
}> {
  const store = await getCurrentStore()

  if (!store || !store.stripeAccountId) {
    return { error: 'errors.noStripeAccount' }
  }

  try {
    const status = await getAccountStatus(store.stripeAccountId)

    await db
      .update(stores)
      .set({
        stripeChargesEnabled: status.chargesEnabled,
        stripeOnboardingComplete: status.chargesEnabled && status.detailsSubmitted,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/payments')

    return {
      success: true,
      chargesEnabled: status.chargesEnabled,
    }
  } catch (error) {
    console.error('Stripe sync error:', error)
    return { error: 'errors.stripe.syncFailed' }
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

  try {
    const url = await createAccountLoginLink(store.stripeAccountId)
    return { url }
  } catch (error) {
    console.error('Stripe dashboard link error:', error)
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

  // Note: We don't delete the Stripe account, just unlink it
  await db
    .update(stores)
    .set({
      stripeAccountId: null,
      stripeChargesEnabled: false,
      stripeOnboardingComplete: false,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/payments')
  revalidatePath('/dashboard/settings')

  return { success: true }
}

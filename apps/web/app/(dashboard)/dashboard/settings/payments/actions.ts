'use server'

import { db } from '@louez/db'
import { stores } from '@louez/db'
import { users } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  createConnectAccount,
  createAccountLink,
  createAccountLoginLink,
  getAccountStatus,
} from '@/lib/stripe'
import { env } from '@/env'

const APP_URL = env.NEXT_PUBLIC_APP_URL

/**
 * Start Stripe Connect onboarding
 * Creates a new Express account if needed and returns the onboarding URL
 */
export async function startStripeOnboarding(): Promise<{
  url?: string
  error?: string
}> {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  try {
    let accountId = store.stripeAccountId

    // If already has an active account, return error
    if (accountId && store.stripeChargesEnabled) {
      return { error: 'errors.stripe.alreadyConnected' }
    }

    // Create new account if needed
    if (!accountId) {
      const storeCountry = store.settings?.country || 'FR'
      const owner = await db.query.users.findFirst({
        where: eq(users.id, store.userId),
        columns: { email: true },
      })
      const accountEmail = (store.email || owner?.email || '').trim()

      if (!accountEmail) {
        return { error: 'errors.email' }
      }

      const account = await createConnectAccount({
        email: accountEmail,
        country: storeCountry,
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
    const url = await createAccountLink(
      accountId,
      `${APP_URL}/dashboard/settings/payments/callback`,
      `${APP_URL}/dashboard/settings/payments/refresh`
    )

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
 * Get Stripe Express dashboard link
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

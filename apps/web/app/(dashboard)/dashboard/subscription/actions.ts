'use server'

import { z } from 'zod'

import { getCurrentStore, hasPermission } from '@/lib/store-context'
import { billingPageHref } from '@/lib/billing/billing-pages'
import { log } from '@/lib/evlog'
import { legacyBillingApplies } from '@/lib/billing/policy'
import {
  SubscriptionPlanError,
  createSubscriptionCheckoutSession,
  createCustomerPortalSession,
  cancelSubscription as cancelSub,
  changeSubscriptionPlan as changePlanInPlace,
  getPlatformCustomerId,
  reactivateSubscription as reactivateSub,
  switchToPayAsYouGo as switchToPayg,
} from '@/lib/stripe/subscriptions'
import { revalidatePath } from 'next/cache'
import type { Currency } from '@/lib/plans.shared'
import { env } from '@/env'

const planChangeSchema = z.object({
  planSlug: z.string().min(1).max(50),
  interval: z.enum(['monthly', 'yearly']),
  currency: z.enum(['eur', 'usd']),
})

export async function createCheckoutSession({
  planSlug,
  interval,
  currency,
}: {
  planSlug: string
  interval: 'monthly' | 'yearly'
  currency: Currency
}) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'not_authenticated', url: null }
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    return { error: 'errors.permissionDenied', url: null }
  }

  try {
    const session = await createSubscriptionCheckoutSession({
      storeId: store.id,
      planSlug,
      interval,
      currency,
      trialDays: store.trialDays ?? 0,
      stripeCouponId: store.stripeCouponId ?? undefined,
      successUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/subscription?success=true`,
      cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/subscription?canceled=true`,
    })

    return session
  } catch (error) {
    // A live subscription changes plan in place (changeSubscriptionPlan).
    if (error instanceof SubscriptionPlanError) {
      return { error: 'errors.unsupportedOperation', url: null }
    }
    console.error('Error creating checkout session:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create checkout session'
    return { error: errorMessage, url: null }
  }
}

/**
 * Moves the store's live plan subscription to another plan or interval, on the same
 * Stripe subscription, with the checkout's permission checks.
 */
export async function changeSubscriptionPlan(
  input: z.infer<typeof planChangeSchema>,
): Promise<{ success: true } | { error: string }> {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'not_authenticated' }
  }

  if (!hasPermission(store.role, 'manage_settings')) {
    return { error: 'errors.permissionDenied' }
  }

  const parsed = planChangeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'errors.invalidData' }
  }

  try {
    const { planSlug, interval, currency } = parsed.data
    await changePlanInPlace(store.id, planSlug, interval, currency)
    revalidatePath('/dashboard/settings/subscription')
    return { success: true }
  } catch (error) {
    if (error instanceof SubscriptionPlanError) {
      return { error: 'errors.unsupportedOperation' }
    }
    log.error(
      'billing',
      `plan change of store ${store.id} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { error: 'errors.generic' }
  }
}

export async function openCustomerPortal() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  if (!hasPermission(store.role, 'manage_settings')) {
    throw new Error('errors.permissionDenied')
  }

  return createCustomerPortalSession(store.id)
}

/**
 * Open the Stripe billing portal for a pay-as-you-go store. Unlike subscriptions,
 * a PAYG store may not have a Stripe customer yet (mode is toggled by an admin, not
 * via checkout), so we ensure one exists first. The portal lets the owner add a
 * payment method and view/pay their month-end invoices. A store the billing service
 * bills adds its card on the billing pages instead (louez-billing docs/api, Q39).
 */
export async function openBillingPortal() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  if (!hasPermission(store.role, 'manage_settings')) {
    throw new Error('errors.permissionDenied')
  }

  // Refuses with platform billing off, and never creates a customer for a store the
  // billing service bills.
  await getPlatformCustomerId(store.id)
  if (!(await legacyBillingApplies(store.id, new Date()))) {
    return { url: billingPageHref('/payment-method') }
  }
  return createCustomerPortalSession(store.id)
}

export async function cancelSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  if (!hasPermission(store.role, 'manage_settings')) {
    throw new Error('errors.permissionDenied')
  }

  const result = await cancelSub(store.id)
  revalidatePath('/dashboard/settings/subscription')
  return result
}

/**
 * Owner-initiated switch to pay-as-you-go. Immediate on the free plan; deferred to
 * period end on a paid plan (avoids double billing). Returns the outcome so the UI
 * can confirm or show the effective date.
 */
export async function switchToPayAsYouGo() {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' as const }

  if (!hasPermission(store.role, 'manage_settings')) {
    return { error: 'errors.permissionDenied' as const }
  }

  try {
    const result = await switchToPayg(store.id)
    revalidatePath('/dashboard/settings/subscription')
    return { success: true as const, ...result }
  } catch (error) {
    console.error('Error switching to pay-as-you-go:', error)
    return { error: 'errors.switchFailed' as const }
  }
}

export async function reactivateSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  if (!hasPermission(store.role, 'manage_settings')) {
    throw new Error('errors.permissionDenied')
  }

  const result = await reactivateSub(store.id)
  revalidatePath('/dashboard/settings/subscription')
  return result
}

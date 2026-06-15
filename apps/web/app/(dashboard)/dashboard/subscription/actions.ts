'use server'

import { getCurrentStore } from '@/lib/store-context'
import {
  createSubscriptionCheckoutSession,
  createCustomerPortalSession,
  cancelSubscription as cancelSub,
  getOrCreateStripeCustomer,
  reactivateSubscription as reactivateSub,
  switchToPayAsYouGo as switchToPayg,
} from '@/lib/stripe/subscriptions'
import { revalidatePath } from 'next/cache'
import type { Currency } from '@/lib/plans'
import { env } from '@/env'

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

  try {
    const session = await createSubscriptionCheckoutSession({
      storeId: store.id,
      planSlug,
      interval,
      currency,
      trialDays: store.trialDays ?? 0,
      stripeCouponId: store.stripeCouponId ?? undefined,
      successUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/subscription?success=true`,
      cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/subscription?canceled=true`,
    })

    return session
  } catch (error) {
    console.error('Error creating checkout session:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create checkout session'
    return { error: errorMessage, url: null }
  }
}

export async function openCustomerPortal() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  return createCustomerPortalSession(store.id)
}

/**
 * Open the Stripe billing portal for a pay-as-you-go store. Unlike subscriptions,
 * a PAYG store may not have a Stripe customer yet (mode is toggled by an admin, not
 * via checkout), so we ensure one exists first. The portal lets the owner add a
 * payment method and view/pay their month-end invoices.
 */
export async function openBillingPortal() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  await getOrCreateStripeCustomer(store.id)
  return createCustomerPortalSession(store.id)
}

export async function cancelSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  const result = await cancelSub(store.id)
  revalidatePath('/dashboard/subscription')
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

  try {
    const result = await switchToPayg(store.id)
    revalidatePath('/dashboard/subscription')
    return { success: true as const, ...result }
  } catch (error) {
    console.error('Error switching to pay-as-you-go:', error)
    return { error: 'errors.switchFailed' as const }
  }
}

export async function reactivateSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  const result = await reactivateSub(store.id)
  revalidatePath('/dashboard/subscription')
  return result
}

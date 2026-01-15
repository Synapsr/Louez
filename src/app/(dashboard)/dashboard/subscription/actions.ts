'use server'

import { getCurrentStore } from '@/lib/store-context'
import {
  createSubscriptionCheckoutSession,
  createCustomerPortalSession,
  cancelSubscription as cancelSub,
  reactivateSubscription as reactivateSub,
} from '@/lib/stripe/subscriptions'
import { revalidatePath } from 'next/cache'

export async function createCheckoutSession({
  planSlug,
  interval,
}: {
  planSlug: string
  interval: 'monthly' | 'yearly'
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
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/subscription?success=true`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/subscription?canceled=true`,
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

export async function cancelSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  const result = await cancelSub(store.id)
  revalidatePath('/dashboard/subscription')
  return result
}

export async function reactivateSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  const result = await reactivateSub(store.id)
  revalidatePath('/dashboard/subscription')
  return result
}

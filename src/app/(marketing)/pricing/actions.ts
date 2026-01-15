'use server'

import { getCurrentStore } from '@/lib/store-context'
import { createSubscriptionCheckoutSession } from '@/lib/stripe/subscriptions'

export async function createCheckoutSession({
  planSlug,
  interval,
}: {
  planSlug: string
  interval: 'monthly' | 'yearly'
}) {
  const store = await getCurrentStore()

  if (!store) {
    // Return redirect URL instead of calling redirect()
    // because redirect() throws an error that gets caught by try/catch
    return {
      error: 'not_authenticated',
      url: null,
      sessionId: null,
      redirectTo: '/login?redirect=/pricing',
    }
  }

  try {
    const session = await createSubscriptionCheckoutSession({
      storeId: store.id,
      planSlug,
      interval,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/subscription?success=true`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pricing?canceled=true`,
    })

    return session
  } catch (error) {
    console.error('Error creating checkout session:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to create checkout session'
    return { error: errorMessage, url: null, sessionId: null }
  }
}

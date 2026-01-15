'use server'

import { getCurrentStore } from '@/lib/store-context'
import {
  createCustomerPortalSession,
  cancelSubscription as cancelSub,
  reactivateSubscription as reactivateSub,
} from '@/lib/stripe/subscriptions'
import { revalidatePath } from 'next/cache'

export async function openCustomerPortal() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  return createCustomerPortalSession(store.id)
}

export async function cancelSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  const result = await cancelSub(store.id)
  revalidatePath('/dashboard/settings/subscription')
  return result
}

export async function reactivateSubscription() {
  const store = await getCurrentStore()
  if (!store) throw new Error('Unauthorized')

  const result = await reactivateSub(store.id)
  revalidatePath('/dashboard/settings/subscription')
  return result
}

'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { db } from '@louez/db'
import { stores } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { searchPlaces, getPlaceDetails } from '@/lib/google-places'
import {
  reviewBoosterSettingsSchema,
  googlePlaceSearchSchema,
  type ReviewBoosterSettingsInput,
} from '@louez/validations'

export async function updateReviewBoosterSettings(data: ReviewBoosterSettingsInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Check plan access
  const plan = await getStorePlan(store.id)
  if (!plan.features.reviewBooster) {
    return { error: 'errors.featureNotAvailable' }
  }

  const validated = reviewBoosterSettingsSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  await db
    .update(stores)
    .set({
      reviewBoosterSettings: validated.data,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/review-booster')
  revalidatePath(`/${store.slug}`) // Revalidate storefront
  return { success: true }
}

export async function searchGooglePlaces(query: string) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized', results: [] }
  }

  const validated = googlePlaceSearchSchema.safeParse({ query })
  if (!validated.success) {
    return { error: 'errors.invalidData', results: [] }
  }

  const results = await searchPlaces(validated.data.query)
  return { results }
}

export async function fetchGooglePlaceDetails(placeId: string) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized', details: null }
  }

  if (!placeId) {
    return { error: 'errors.invalidData', details: null }
  }

  const details = await getPlaceDetails(placeId)
  return { details }
}

export async function getReviewBoosterTemplate() {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const template = store.reviewBoosterSettings?.template || {}
  return { template }
}

export async function updateReviewBoosterTemplate(template: {
  subject?: string
  emailMessage?: string
  smsMessage?: string
}) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Check plan access
  const plan = await getStorePlan(store.id)
  if (!plan.features.reviewBooster) {
    return { error: 'errors.featureNotAvailable' }
  }

  // Update template within reviewBoosterSettings
  const currentSettings = store.reviewBoosterSettings || {
    enabled: false,
    googlePlaceId: null,
    googlePlaceName: null,
    googlePlaceAddress: null,
    googleRating: null,
    googleReviewCount: null,
    displayReviewsOnStorefront: false,
    showReviewPromptInPortal: false,
    autoSendThankYouEmail: false,
    autoSendThankYouSms: false,
    emailDelayHours: 24,
    smsDelayHours: 24,
  }

  await db
    .update(stores)
    .set({
      reviewBoosterSettings: {
        ...currentSettings,
        template,
      },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/review-booster')
  return { success: true }
}

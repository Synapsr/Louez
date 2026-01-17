'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { getCurrentStore } from '@/lib/store-context'
import { getStorePlan } from '@/lib/plan-limits'
import { searchPlaces, getPlaceDetails } from '@/lib/google-places'
import {
  reviewBoosterSettingsSchema,
  googlePlaceSearchSchema,
  type ReviewBoosterSettingsInput,
} from '@/lib/validations/review-booster'

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

'use server'

import { auth } from '@/lib/auth'
import { db } from '@louez/db'
import { stores, storeMembers } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { setActiveStoreId, getActiveStoreId } from '@/lib/store-context'
import {
  storeInfoSchema,
  type StoreInfoInput,
} from '@louez/validations'
import { defaultBusinessHours } from '@louez/validations'
import { getTimezoneForCountry } from '@/lib/utils/countries'
import { generateReferralCode, isValidReferralCode } from '@/lib/utils/referral'

export async function createStore(data: StoreInfoInput) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const validated = storeInfoSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Check if slug is already taken
  const existingStore = await db.query.stores.findFirst({
    where: eq(stores.slug, validated.data.slug),
  })

  if (existingStore) {
    return { error: 'errors.slugTaken' }
  }

  // Check if we're updating an existing incomplete store or creating new
  const activeStoreId = await getActiveStoreId()
  let storeToUpdate = null

  if (activeStoreId) {
    // Check if user has access to this store and it's not completed
    const membership = await db.query.storeMembers.findFirst({
      where: and(
        eq(storeMembers.storeId, activeStoreId),
        eq(storeMembers.userId, session.user.id),
        eq(storeMembers.role, 'owner')
      ),
    })

    if (membership) {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, activeStoreId),
      })
      if (store && !store.onboardingCompleted) {
        storeToUpdate = store
      }
    }
  }

  if (storeToUpdate) {
    // Update existing incomplete store, preserving businessHours if they exist
    const existingSettings = storeToUpdate.settings as { businessHours?: typeof defaultBusinessHours } | null
    const existingBusinessHours = existingSettings?.businessHours?.enabled !== undefined
      ? existingSettings.businessHours
      : defaultBusinessHours
    await db
      .update(stores)
      .set({
        name: validated.data.name,
        slug: validated.data.slug,
        address: validated.data.address || null,
        latitude: validated.data.latitude?.toString() || null,
        longitude: validated.data.longitude?.toString() || null,
        email: validated.data.email || null,
        phone: validated.data.phone || null,
        settings: {
          reservationMode: 'payment',
          minRentalMinutes: 60,
          maxRentalMinutes: null,
          advanceNoticeMinutes: 1440,
          businessHours: existingBusinessHours,
          country: validated.data.country,
          timezone: getTimezoneForCountry(validated.data.country),
          currency: validated.data.currency,
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, storeToUpdate.id))
  } else {
    // Resolve referral code from cookie (set during login with ?ref= param)
    const cookieStore = await cookies()
    const referralCookie = cookieStore.get('louez_referral')?.value
    let referredByUserId: string | null = null
    let referredByStoreId: string | null = null

    if (referralCookie && isValidReferralCode(referralCookie)) {
      const referrerStore = await db.query.stores.findFirst({
        where: eq(stores.referralCode, referralCookie),
      })
      if (referrerStore && referrerStore.userId !== session.user.id) {
        referredByUserId = referrerStore.userId
        referredByStoreId = referrerStore.id
      }
      // Clear the cookie regardless of validity
      cookieStore.delete('louez_referral')
    }

    // Generate a unique referral code for this new store
    let newReferralCode = generateReferralCode()
    for (let attempt = 0; attempt < 10; attempt++) {
      const exists = await db.query.stores.findFirst({
        where: eq(stores.referralCode, newReferralCode),
      })
      if (!exists) break
      newReferralCode = generateReferralCode()
    }

    // Create new store
    const [newStore] = await db
      .insert(stores)
      .values({
        userId: session.user.id,
        name: validated.data.name,
        slug: validated.data.slug,
        address: validated.data.address || null,
        latitude: validated.data.latitude?.toString() || null,
        longitude: validated.data.longitude?.toString() || null,
        email: validated.data.email || null,
        phone: validated.data.phone || null,
        referralCode: newReferralCode,
        referredByUserId,
        referredByStoreId,
        settings: {
          reservationMode: 'payment',
          minRentalMinutes: 60,
          maxRentalMinutes: null,
          advanceNoticeMinutes: 1440,
          businessHours: defaultBusinessHours,
          country: validated.data.country,
          timezone: getTimezoneForCountry(validated.data.country),
          currency: validated.data.currency,
        },
      })
      .$returningId()

    // Create owner membership
    await db.insert(storeMembers).values({
      storeId: newStore.id,
      userId: session.user.id,
      role: 'owner',
    })

    // Set as active store (will succeed since we just created ownership above)
    const setStoreResult = await setActiveStoreId(newStore.id)
    if (!setStoreResult.success) {
      // This should not happen since we just created the store and membership
      console.error('[SECURITY] Failed to set active store after creation:', setStoreResult.error)
    }
  }

  revalidatePath('/onboarding')
  return { success: true }
}

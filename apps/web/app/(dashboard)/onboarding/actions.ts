'use server'

import { auth } from '@/lib/auth'
import { db } from '@louez/db'
import { stores, storeMembers, subscriptions } from '@louez/db'
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
import {
  getDefaultFreeReservations,
  getDefaultPayAsYouGoConfigSnapshot,
} from '@/lib/pay-as-you-go/defaults'
import { resolveReferralAttribution } from '@/lib/referral/attribution'
import { getReferralProgramConfig } from '@/lib/referral/defaults'
import { referralCookieDomain } from '@/lib/referral/link'

export async function createStore(data: StoreInfoInput) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const validated = storeInfoSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Check if we're updating an existing incomplete store or creating a new one
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

  // Fallback: if active-store cookie is missing, reuse any incomplete store owned by the user
  if (!storeToUpdate) {
    const incompleteOwnedStores = await db.query.stores.findMany({
      where: and(
        eq(stores.userId, session.user.id),
        eq(stores.onboardingCompleted, false)
      ),
      orderBy: (storeFields, { desc }) => [desc(storeFields.updatedAt)],
    })

    if (incompleteOwnedStores.length > 0) {
      const slugMatchedStore = incompleteOwnedStores.find(
        (store) => store.slug === validated.data.slug
      )
      storeToUpdate = slugMatchedStore ?? incompleteOwnedStores[0]
    }
  }

  // Slug conflict check: allow keeping/editing the current incomplete store slug
  const existingStore = await db.query.stores.findFirst({
    where: eq(stores.slug, validated.data.slug),
  })
  if (existingStore) {
    const canReuseExistingStore =
      existingStore.userId === session.user.id &&
      existingStore.onboardingCompleted === false

    if (!storeToUpdate && canReuseExistingStore) {
      storeToUpdate = existingStore
    }

    if (!storeToUpdate || existingStore.id !== storeToUpdate.id) {
      return { error: 'errors.slugTaken' }
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
          turnoverBufferMinutes: 0,
          businessHours: existingBusinessHours,
          country: validated.data.country,
          timezone: getTimezoneForCountry(validated.data.country),
          currency: validated.data.currency,
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, storeToUpdate.id))

    // Ensure the updated store stays active for subsequent onboarding steps
    const setStoreResult = await setActiveStoreId(storeToUpdate.id)
    if (!setStoreResult.success) {
      console.error(
        '[SECURITY] Failed to set active store after onboarding update:',
        setStoreResult.error
      )
    }
  } else {
    // Resolve referral code from cookie (set during login with ?ref= param)
    const cookieStore = await cookies()
    const referralCookie = cookieStore.get('louez_referral')?.value
    let referredByUserId: string | null = null
    let referredByStoreId: string | null = null

    if (referralCookie && isValidReferralCode(referralCookie)) {
      // Attribution applies only to a user's first OWNED store. The .louez.io cookie can
      // survive for 30 days, so without this guard a referred user who creates a second
      // store would re-credit the referrer and re-claim the Referred Reward on every signup.
      // Filter on role 'owner' so a user who is only a team member elsewhere is still
      // attributed when they create their own first store.
      const ownsAStore = await db.query.storeMembers.findFirst({
        where: and(
          eq(storeMembers.userId, session.user.id),
          eq(storeMembers.role, 'owner'),
        ),
        columns: { id: true },
      })
      if (!ownsAStore) {
        const referrerStore = await db.query.stores.findFirst({
          where: eq(stores.referralCode, referralCookie),
          columns: { id: true, userId: true },
        })
        const attribution = resolveReferralAttribution({
          refCode: referralCookie,
          referrerStore: referrerStore ?? null,
          currentUserId: session.user.id,
        })
        referredByUserId = attribution?.referredByUserId ?? null
        referredByStoreId = attribution?.referredByStoreId ?? null
      }
    }

    // Consume the referral cookie exactly once, clearing it with the SAME domain it was set
    // with — a bare delete() emits a host-only expiry that does not match the .louez.io
    // cookie, so it would otherwise linger and re-attribute later signups.
    if (referralCookie) {
      const cookieDomain = referralCookieDomain()
      cookieStore.set('louez_referral', '', {
        domain: cookieDomain,
        path: '/',
        maxAge: 0,
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieDomain !== undefined,
      })
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
          turnoverBufferMinutes: 0,
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

    // New stores default to pay-as-you-go billing (the owner can switch to a
    // subscription plan at any time from the subscription page). Snapshot the current
    // default pricing offer (PAYG_DEFAULT_PRICING env, or the platform default ladder)
    // so the store keeps these tariffs for life even if the offer later changes.
    await db.insert(subscriptions).values({
      storeId: newStore.id,
      planSlug: 'pay_as_you_go',
      billingMode: 'pay_as_you_go',
      payAsYouGoConfig: getDefaultPayAsYouGoConfigSnapshot(
        validated.data.currency,
      ),
      // Welcome gift: free reservations (commission waived) for the new store. A store
      // that signed up through a referral gets the larger Referred Reward instead.
      freeReservationsGranted: referredByStoreId
        ? getReferralProgramConfig().referredRewardFreeReservations
        : getDefaultFreeReservations(),
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

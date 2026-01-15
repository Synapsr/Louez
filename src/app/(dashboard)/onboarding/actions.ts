'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stores, products, storeMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { setActiveStoreId, getActiveStoreId } from '@/lib/store-context'
import {
  storeInfoSchema,
  brandingSchema,
  firstProductSchema,
  stripeSetupSchema,
  type StoreInfoInput,
  type BrandingInput,
  type FirstProductInput,
  type StripeSetupInput,
} from '@/lib/validations/onboarding'
import { defaultBusinessHours } from '@/lib/validations/business-hours'

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
          pricingMode: validated.data.pricingMode,
          reservationMode: 'payment',
          minDuration: 1,
          maxDuration: null,
          advanceNotice: 24,
          businessHours: existingBusinessHours,
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, storeToUpdate.id))
  } else {
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
        settings: {
          pricingMode: validated.data.pricingMode,
          reservationMode: 'payment',
          minDuration: 1,
          maxDuration: null,
          advanceNotice: 24,
          businessHours: defaultBusinessHours,
        },
      })
      .$returningId()

    // Create owner membership
    await db.insert(storeMembers).values({
      storeId: newStore.id,
      userId: session.user.id,
      role: 'owner',
    })

    // Set as active store
    await setActiveStoreId(newStore.id)
  }

  revalidatePath('/onboarding')
  return { success: true }
}

export async function updateBranding(data: BrandingInput) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const validated = brandingSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Get active store from cookie
  const activeStoreId = await getActiveStoreId()
  if (!activeStoreId) {
    return { error: 'errors.storeNotFound' }
  }

  // Verify ownership
  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, activeStoreId),
      eq(storeMembers.userId, session.user.id),
      eq(storeMembers.role, 'owner')
    ),
  })

  if (!membership) {
    return { error: 'errors.unauthorized' }
  }

  await db
    .update(stores)
    .set({
      logoUrl: validated.data.logoUrl || null,
      theme: {
        mode: validated.data.theme,
        primaryColor: validated.data.primaryColor,
      },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, activeStoreId))

  revalidatePath('/onboarding/branding')
  return { success: true }
}

export async function createFirstProduct(data: FirstProductInput) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const validated = firstProductSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Get active store from cookie
  const activeStoreId = await getActiveStoreId()
  if (!activeStoreId) {
    return { error: 'errors.storeNotFound' }
  }

  // Verify membership
  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, activeStoreId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  if (!membership) {
    return { error: 'errors.unauthorized' }
  }

  const price = validated.data.price.replace(',', '.')
  const deposit = validated.data.deposit
    ? validated.data.deposit.replace(',', '.')
    : '0'
  const quantity = parseInt(validated.data.quantity, 10)

  await db.insert(products).values({
    storeId: activeStoreId,
    name: validated.data.name,
    description: validated.data.description || null,
    price: price,
    deposit: deposit,
    quantity: quantity,
    images: validated.data.images || [],
    status: 'active',
  })

  revalidatePath('/onboarding/product')
  return { success: true }
}

export async function completeOnboarding(data: StripeSetupInput) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const validated = stripeSetupSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Get active store from cookie
  const activeStoreId = await getActiveStoreId()
  if (!activeStoreId) {
    return { error: 'errors.storeNotFound' }
  }

  // Verify ownership
  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, activeStoreId),
      eq(storeMembers.userId, session.user.id),
      eq(storeMembers.role, 'owner')
    ),
  })

  if (!membership) {
    return { error: 'errors.unauthorized' }
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, activeStoreId),
  })

  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  const currentSettings = store.settings || {
    pricingMode: 'day' as const,
    minDuration: 1,
    maxDuration: null,
    advanceNotice: 24,
    openingHours: null,
  }

  await db
    .update(stores)
    .set({
      settings: {
        ...currentSettings,
        reservationMode: validated.data.reservationMode,
      },
      onboardingCompleted: true,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, activeStoreId))

  revalidatePath('/onboarding/stripe')
  return { success: true }
}

export async function getOnboardingStore() {
  const session = await auth()
  if (!session?.user?.id) {
    return null
  }

  // Get active store from cookie
  const activeStoreId = await getActiveStoreId()
  if (!activeStoreId) {
    return null
  }

  // Verify membership
  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, activeStoreId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  if (!membership) {
    return null
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.id, activeStoreId),
  })

  return store
}

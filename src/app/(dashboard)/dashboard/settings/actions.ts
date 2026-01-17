'use server'

import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { stores } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getTimezoneForCountry } from '@/lib/utils/countries'
import { z } from 'zod'

// Slug validation schema
const slugSchema = z.string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug_format_invalid'
  })

interface StoreSettingsInput {
  name: string
  description?: string
  email?: string
  phone?: string
  address?: string
  country: string
  currency: string
  latitude?: number | null
  longitude?: number | null
  // Billing address
  billingAddressSameAsStore: boolean
  billingAddress?: string
  billingCity?: string
  billingPostalCode?: string
  billingCountry?: string
  // Settings
  pricingMode: 'day' | 'hour' | 'week'
  reservationMode: 'payment' | 'request'
  pendingBlocksAvailability: boolean
  minDuration: number
  maxDuration: number | null
  advanceNotice: number
  requireCustomerAddress: boolean
}

export async function updateStoreSettings(data: StoreSettingsInput) {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    await db
      .update(stores)
      .set({
        name: data.name,
        description: data.description || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        latitude: data.latitude?.toString() || null,
        longitude: data.longitude?.toString() || null,
        settings: {
          pricingMode: data.pricingMode,
          reservationMode: data.reservationMode,
          pendingBlocksAvailability: data.pendingBlocksAvailability,
          minDuration: data.minDuration,
          maxDuration: data.maxDuration,
          advanceNotice: data.advanceNotice,
          requireCustomerAddress: data.requireCustomerAddress,
          businessHours: store.settings?.businessHours,
          country: data.country,
          timezone: getTimezoneForCountry(data.country),
          currency: data.currency,
          tax: store.settings?.tax,
          billingAddress: {
            useSameAsStore: data.billingAddressSameAsStore,
            address: data.billingAddressSameAsStore ? undefined : data.billingAddress,
            city: data.billingAddressSameAsStore ? undefined : data.billingCity,
            postalCode: data.billingAddressSameAsStore ? undefined : data.billingPostalCode,
            country: data.billingAddressSameAsStore ? undefined : data.billingCountry,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error updating store settings:', error)
    return { error: 'errors.updateSettingsError' }
  }
}

/**
 * Check if a slug is available for the current store
 */
export async function checkSlugAvailability(slug: string): Promise<{
  available: boolean
  error?: string
}> {
  try {
    const store = await getCurrentStore()
    if (!store) {
      return { available: false, error: 'errors.storeNotFound' }
    }

    // Validate slug format
    const result = slugSchema.safeParse(slug)
    if (!result.success) {
      return { available: false, error: 'errors.slugInvalidFormat' }
    }

    // Check if slug is already taken by another store
    const existingStore = await db.query.stores.findFirst({
      where: and(
        eq(stores.slug, slug),
        ne(stores.id, store.id)
      ),
    })

    return { available: !existingStore }
  } catch (error) {
    console.error('Error checking slug availability:', error)
    return { available: false, error: 'errors.checkSlugError' }
  }
}

/**
 * Update the store slug (URL)
 */
export async function updateStoreSlug(newSlug: string): Promise<{
  success?: boolean
  error?: string
  newSlug?: string
}> {
  try {
    const store = await getCurrentStore()
    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Validate slug format
    const result = slugSchema.safeParse(newSlug)
    if (!result.success) {
      return { error: 'errors.slugInvalidFormat' }
    }

    // Check if slug is the same
    if (store.slug === newSlug) {
      return { error: 'errors.slugUnchanged' }
    }

    // Check if slug is available
    const existingStore = await db.query.stores.findFirst({
      where: and(
        eq(stores.slug, newSlug),
        ne(stores.id, store.id)
      ),
    })

    if (existingStore) {
      return { error: 'errors.slugTaken' }
    }

    // Update the slug
    const oldSlug = store.slug
    await db
      .update(stores)
      .set({
        slug: newSlug,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    // Revalidate all relevant paths
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/settings')
    revalidatePath(`/${oldSlug}`)
    revalidatePath(`/${newSlug}`)

    return { success: true, newSlug }
  } catch (error) {
    console.error('Error updating store slug:', error)
    return { error: 'errors.updateSlugError' }
  }
}

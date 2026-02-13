'use server'

import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { businessHoursSchema, type BusinessHoursInput } from '@louez/validations'

export async function updateBusinessHours(data: BusinessHoursInput) {
  try {
    const store = await getCurrentStore()

    if (!store) {
      return { error: 'errors.storeNotFound' }
    }

    // Validate input
    const validationResult = businessHoursSchema.safeParse(data)
    if (!validationResult.success) {
      return { error: 'errors.invalidBusinessHours' }
    }

    const validatedData = validationResult.data

    // Merge with existing settings
    const currentSettings = store.settings || {
      reservationMode: 'payment' as const,
      minRentalMinutes: 60,
      maxRentalMinutes: null,
      advanceNoticeMinutes: 1440,
    }

    // Update store settings with business hours
    await db
      .update(stores)
      .set({
        settings: {
          ...currentSettings,
          businessHours: validatedData,
        },
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/hours')
    revalidatePath('/dashboard/settings')
    // Also revalidate storefront pages that use business hours
    revalidatePath(`/${store.slug}`)
    revalidatePath(`/${store.slug}/catalog`)
    revalidatePath(`/${store.slug}/rental`)
    return { success: true }
  } catch (error) {
    console.error('Error updating business hours:', error)
    return { error: 'errors.updateBusinessHoursError' }
  }
}

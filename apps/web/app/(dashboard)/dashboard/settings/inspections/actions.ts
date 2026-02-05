'use server'

import { db } from '@louez/db'
import { stores } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { inspectionSettingsSchema } from '@louez/validations'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { InspectionSettings, StoreSettings } from '@louez/types'

type InspectionSettingsInput = {
  enabled: boolean
  mode: 'optional' | 'recommended' | 'required'
  requireCustomerSignature: boolean
  autoGeneratePdf: boolean
  maxPhotosPerItem: number
}

export async function updateInspectionSettings(
  data: InspectionSettingsInput
): Promise<{ success?: boolean; error?: string }> {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = inspectionSettingsSchema.safeParse(data)

  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Build inspection settings object
  const inspectionSettings: InspectionSettings = {
    enabled: validated.data.enabled,
    mode: validated.data.mode,
    requireCustomerSignature: validated.data.requireCustomerSignature,
    autoGeneratePdf: validated.data.autoGeneratePdf,
    maxPhotosPerItem: validated.data.maxPhotosPerItem,
  }

  // Get current settings and merge
  const currentSettings: StoreSettings = store.settings || {
    pricingMode: 'day',
    reservationMode: 'request',
    advanceNotice: 24,
  }

  await db
    .update(stores)
    .set({
      settings: {
        ...currentSettings,
        inspection: inspectionSettings,
      },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/inspections')

  return { success: true }
}

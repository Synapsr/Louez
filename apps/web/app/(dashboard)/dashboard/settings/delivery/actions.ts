'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@louez/db'
import { stores } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import type { DeliverySettings } from '@louez/types'

const DELIVERY_MODES = ['optional', 'required', 'included'] as const

const deliverySettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(DELIVERY_MODES),
  pricePerKm: z.number().min(0).max(100),
  roundTrip: z.boolean(),
  minimumFee: z.number().min(0).max(1000),
  maximumDistance: z.number().min(1).max(500).nullable(),
  freeDeliveryThreshold: z.number().min(0).max(100000).nullable(),
})

type DeliverySettingsInput = z.infer<typeof deliverySettingsSchema>

export async function updateDeliverySettings(data: DeliverySettingsInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = deliverySettingsSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Validate store has coordinates if enabling delivery
  if (validated.data.enabled && (!store.latitude || !store.longitude)) {
    return { error: 'errors.storeCoordinatesRequired' }
  }

  const deliverySettings: DeliverySettings = {
    enabled: validated.data.enabled,
    mode: validated.data.mode,
    pricePerKm: validated.data.pricePerKm,
    roundTrip: validated.data.roundTrip,
    minimumFee: validated.data.minimumFee,
    maximumDistance: validated.data.maximumDistance,
    freeDeliveryThreshold: validated.data.freeDeliveryThreshold,
  }

  const currentSettings = store.settings || {
    reservationMode: 'payment' as const,
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
  }

  await db
    .update(stores)
    .set({
      settings: {
        ...currentSettings,
        delivery: deliverySettings,
      },
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/delivery')
  revalidatePath('/dashboard/settings')
  return { success: true }
}

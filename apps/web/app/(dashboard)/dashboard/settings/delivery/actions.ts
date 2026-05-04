'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { nanoid } from 'nanoid'

import { db } from '@louez/db'
import { storeLocations, stores } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import type { DeliverySettings } from '@louez/types'

const DELIVERY_MODES = ['optional', 'required', 'included'] as const

const deliverySettingsSchema = z.object({
  enabled: z.boolean(),
  multiLocationEnabled: z.boolean().optional(),
  mode: z.enum(DELIVERY_MODES),
  pricePerKm: z.number().min(0).max(100),
  minimumFee: z.number().min(0).max(1000),
  maximumDistance: z.number().min(1).max(500).nullable(),
  freeDeliveryThreshold: z.number().min(0).max(100000).nullable(),
  minimumOrderAmountForDelivery: z.number().min(0).max(100000).nullable(),
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
    multiLocationEnabled: validated.data.multiLocationEnabled ?? false,
    mode: validated.data.mode,
    pricePerKm: validated.data.pricePerKm,
    minimumFee: validated.data.minimumFee,
    maximumDistance: validated.data.maximumDistance,
    freeDeliveryThreshold: validated.data.freeDeliveryThreshold,
    minimumOrderAmountForDelivery: validated.data.minimumOrderAmountForDelivery,
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

const locationSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(255),
  address: z.string().trim().min(1),
  city: z.string().trim().max(255).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  country: z.string().trim().length(2).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
})

export async function upsertStoreLocation(data: z.infer<typeof locationSchema>) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = locationSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  const values = {
    storeId: store.id,
    name: validated.data.name,
    address: validated.data.address,
    city: validated.data.city || null,
    postalCode: validated.data.postalCode || null,
    country: validated.data.country || store.settings?.country || 'FR',
    latitude: validated.data.latitude?.toString() ?? null,
    longitude: validated.data.longitude?.toString() ?? null,
    updatedAt: new Date(),
  }

  if (validated.data.id) {
    await db
      .update(storeLocations)
      .set(values)
      .where(and(
        eq(storeLocations.id, validated.data.id),
        eq(storeLocations.storeId, store.id),
      ))
  } else {
    await db.insert(storeLocations).values({
      ...values,
      id: nanoid(),
    })
  }

  revalidatePath('/dashboard/settings/delivery')
  return { success: true }
}

export async function setStoreLocationActive(id: string, isActive: boolean) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  await db
    .update(storeLocations)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(storeLocations.id, id), eq(storeLocations.storeId, store.id)))

  revalidatePath('/dashboard/settings/delivery')
  return { success: true }
}

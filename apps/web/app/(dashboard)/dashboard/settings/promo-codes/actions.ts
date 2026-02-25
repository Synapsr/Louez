'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'

import { db } from '@louez/db'
import { promoCodes } from '@louez/db'
import { promoCodeServerSchema } from '@louez/validations'
import { getCurrentStore } from '@/lib/store-context'

export async function createPromoCode(data: unknown) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const validated = promoCodeServerSchema.safeParse(data)
  if (!validated.success) return { error: 'errors.invalidData' }

  const code = validated.data.code.toUpperCase()

  // Check for duplicate
  const existing = await db.query.promoCodes.findFirst({
    where: and(
      eq(promoCodes.storeId, store.id),
      sql`UPPER(${promoCodes.code}) = ${code}`
    ),
  })

  if (existing) return { error: 'errors.promoCodeDuplicate' }

  await db.insert(promoCodes).values({
    storeId: store.id,
    code,
    description: validated.data.description || null,
    type: validated.data.type,
    value: validated.data.value.toFixed(2),
    minimumAmount: validated.data.minimumAmount?.toFixed(2) ?? null,
    maxUsageCount: validated.data.maxUsageCount,
    startsAt: validated.data.startsAt,
    expiresAt: validated.data.expiresAt,
    isActive: validated.data.isActive,
  })

  revalidatePath('/dashboard/settings/promo-codes')
  return { success: true }
}

export async function updatePromoCode(id: string, data: unknown) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const validated = promoCodeServerSchema.safeParse(data)
  if (!validated.success) return { error: 'errors.invalidData' }

  const code = validated.data.code.toUpperCase()

  // Check for duplicate (excluding this code)
  const existing = await db.query.promoCodes.findFirst({
    where: and(
      eq(promoCodes.storeId, store.id),
      sql`UPPER(${promoCodes.code}) = ${code}`,
      sql`${promoCodes.id} != ${id}`
    ),
  })

  if (existing) return { error: 'errors.promoCodeDuplicate' }

  await db
    .update(promoCodes)
    .set({
      code,
      description: validated.data.description || null,
      type: validated.data.type,
      value: validated.data.value.toFixed(2),
      minimumAmount: validated.data.minimumAmount?.toFixed(2) ?? null,
      maxUsageCount: validated.data.maxUsageCount,
      startsAt: validated.data.startsAt,
      expiresAt: validated.data.expiresAt,
      isActive: validated.data.isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(promoCodes.id, id), eq(promoCodes.storeId, store.id)))

  revalidatePath('/dashboard/settings/promo-codes')
  return { success: true }
}

export async function togglePromoCode(id: string) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  const promoCode = await db.query.promoCodes.findFirst({
    where: and(eq(promoCodes.id, id), eq(promoCodes.storeId, store.id)),
  })

  if (!promoCode) return { error: 'errors.notFound' }

  await db
    .update(promoCodes)
    .set({
      isActive: !promoCode.isActive,
      updatedAt: new Date(),
    })
    .where(eq(promoCodes.id, id))

  revalidatePath('/dashboard/settings/promo-codes')
  return { success: true }
}

export async function deletePromoCode(id: string) {
  const store = await getCurrentStore()
  if (!store) return { error: 'errors.unauthorized' }

  await db
    .delete(promoCodes)
    .where(and(eq(promoCodes.id, id), eq(promoCodes.storeId, store.id)))

  revalidatePath('/dashboard/settings/promo-codes')
  return { success: true }
}

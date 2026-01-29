'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { getCurrentStore } from '@/lib/store-context'
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'
import { createStoreCoupon } from '@/lib/stripe/coupons'

const adminSettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  discountPercent: z.number().int().min(0).max(100),
  discountDurationMonths: z.number().int().min(0).max(120),
})

type AdminSettingsInput = z.infer<typeof adminSettingsSchema>

export async function updateAdminSettings(data: AdminSettingsInput) {
  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const isAdmin = await isCurrentUserPlatformAdmin()
  if (!isAdmin) {
    return { error: 'errors.unauthorized' }
  }

  const validated = adminSettingsSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  const { trialDays, discountPercent, discountDurationMonths } = validated.data

  // Handle Stripe coupon creation/update
  let stripeCouponId: string | null = store.stripeCouponId ?? null

  if (discountPercent > 0) {
    // Only create new coupon if discount configuration changed
    const discountChanged =
      discountPercent !== store.discountPercent ||
      discountDurationMonths !== store.discountDurationMonths

    if (discountChanged) {
      try {
        stripeCouponId = await createStoreCoupon({
          storeId: store.id,
          percentOff: discountPercent,
          durationMonths: discountDurationMonths,
        })
      } catch (error) {
        console.error('Failed to create Stripe coupon:', error)
        return { error: 'errors.stripeCouponFailed' }
      }
    }
  } else {
    // Clear coupon reference when discount is removed
    stripeCouponId = null
  }

  await db
    .update(stores)
    .set({
      trialDays,
      discountPercent,
      discountDurationMonths,
      stripeCouponId,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  revalidatePath('/dashboard/settings/admin')
  return { success: true }
}

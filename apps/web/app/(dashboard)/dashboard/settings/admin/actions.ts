'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@louez/db'
import { stores, subscriptions } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin'
import { createStoreCoupon } from '@/lib/stripe/coupons'
import { isBillingEnabled } from '@/lib/billing/mode'
import { ensureSubscriptionRow } from '@/lib/pay-as-you-go/pricing-lock'
import { buildAdminBillingPatch } from '@/lib/pay-as-you-go/pricing-lock-core'

const paygTierSchema = z.object({
  upToCount: z.number().int().positive().nullable(),
  priceCents: z.number().int().min(0).max(1_000_000),
})

const payAsYouGoConfigInputSchema = z.object({
  flatRateCents: z.number().int().min(0).max(1_000_000).nullable(),
  tiers: z
    .array(paygTierSchema)
    .max(20)
    .superRefine((tiers, ctx) => {
      // Reject contradictory ladders: at most one open-ended band and no two
      // bands sharing the same upper bound (would make the total order-dependent).
      const bounds = tiers
        .map((t) => t.upToCount)
        .filter((c): c is number => c !== null)
      if (new Set(bounds).size !== bounds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate tier limit',
        })
      }
      if (tiers.filter((t) => t.upToCount === null).length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Multiple open-ended tiers',
        })
      }
    }),
  currency: z.string().length(3),
})

const billingModeSchema = z.enum(['subscription', 'pay_as_you_go'])
// Welcome allowance: number of free reservations gifted to the store.
const freeReservationsSchema = z.number().int().min(0).max(100_000)

const adminSettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  discountPercent: z.number().int().min(0).max(100),
  discountDurationMonths: z.number().int().min(0).max(120),
  billingMode: billingModeSchema,
  payAsYouGoConfig: payAsYouGoConfigInputSchema,
  freeReservationsGranted: freeReservationsSchema,
  // The billing values the form was loaded with. Only the billing fields the admin changed
  // are written, so a save never overwrites a referral reward granted in the meantime, nor
  // re-saves pricing nobody edited.
  loaded: z.object({
    billingMode: billingModeSchema,
    payAsYouGoConfig: payAsYouGoConfigInputSchema,
    freeReservationsGranted: freeReservationsSchema,
  }),
})

export type AdminSettingsInput = z.infer<typeof adminSettingsSchema>

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

  // Every setting on this page (trial, discount coupon, billing mode, pricing, free
  // reservations) belongs to platform billing: refuse rather than half-save it.
  if (!isBillingEnabled()) {
    return { error: 'errors.billingOff' }
  }

  const {
    trialDays,
    discountPercent,
    discountDurationMonths,
    billingMode,
    payAsYouGoConfig,
    freeReservationsGranted,
    loaded,
  } = validated.data

  // Handle Stripe coupon creation/update (network side-effect, kept out of the
  // database transaction below).
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

  // Persist trial/discount (stores) and billing mode/pricing (subscriptions) atomically.
  await db.transaction(async (tx) => {
    await tx
      .update(stores)
      .set({
        trialDays,
        discountPercent,
        discountDurationMonths,
        stripeCouponId,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    const existing = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.storeId, store.id),
      columns: { payAsYouGoConfig: true },
    })
    // A store without a row gets one with the pricing it already pays.
    await ensureSubscriptionRow(tx, store.id)

    const patch = buildAdminBillingPatch({
      submitted: { billingMode, payAsYouGoConfig, freeReservationsGranted },
      loaded,
      stored: existing ?? null,
    })
    if (Object.keys(patch).length > 0) {
      await tx
        .update(subscriptions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(subscriptions.storeId, store.id))
    }
  })

  revalidatePath('/dashboard/settings/admin')
  revalidatePath('/dashboard/settings/subscription')
  return { success: true }
}

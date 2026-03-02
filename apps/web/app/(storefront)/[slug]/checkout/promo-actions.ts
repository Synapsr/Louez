'use server'

import { db } from '@louez/db'
import { promoCodes } from '@louez/db'
import { and, eq, sql } from 'drizzle-orm'

export interface ValidatedPromo {
  id: string
  code: string
  type: 'percentage' | 'fixed'
  value: number
  discountAmount: number
  minimumAmount: number
}

export async function validatePromoCode(
  storeId: string,
  code: string,
  subtotal: number
): Promise<{ success: boolean; error?: string; errorParams?: Record<string, string>; promo?: ValidatedPromo }> {
  if (!code.trim()) {
    return { success: false, error: 'promoCodeInvalid' }
  }

  const promoRow = await db.query.promoCodes.findFirst({
    where: and(
      eq(promoCodes.storeId, storeId),
      sql`UPPER(${promoCodes.code}) = UPPER(${code.trim()})`,
      eq(promoCodes.isActive, true)
    ),
  })

  if (!promoRow) {
    return { success: false, error: 'promoCodeInvalid' }
  }

  const now = new Date()

  if (promoRow.startsAt && promoRow.startsAt > now) {
    return { success: false, error: 'promoCodeNotStarted' }
  }

  if (promoRow.expiresAt && promoRow.expiresAt < now) {
    return { success: false, error: 'promoCodeExpired' }
  }

  if (
    promoRow.maxUsageCount !== null &&
    promoRow.currentUsageCount >= promoRow.maxUsageCount
  ) {
    return { success: false, error: 'promoCodeExhausted' }
  }

  const minAmount = promoRow.minimumAmount
    ? parseFloat(promoRow.minimumAmount)
    : 0
  if (minAmount > 0 && subtotal < minAmount) {
    return {
      success: false,
      error: 'promoCodeMinimumNotMet',
      errorParams: { amount: minAmount.toFixed(2) },
    }
  }

  const promoValue = parseFloat(promoRow.value)
  let discountAmount: number
  if (promoRow.type === 'percentage') {
    discountAmount = Math.min((subtotal * promoValue) / 100, subtotal)
  } else {
    discountAmount = Math.min(promoValue, subtotal)
  }
  discountAmount = Math.round(discountAmount * 100) / 100

  return {
    success: true,
    promo: {
      id: promoRow.id,
      code: promoRow.code,
      type: promoRow.type,
      value: promoValue,
      discountAmount,
      minimumAmount: minAmount,
    },
  }
}

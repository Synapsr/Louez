import { useMemo } from 'react'

import type { PricingMode } from '@louez/types'
import {
  calculateDurationMinutes,
  isRateBasedProduct,
  minutesToPriceDuration,
} from '@louez/utils'

import { calculateCartItemPrice } from '@/lib/utils/cart-pricing'
import { calculateDuration } from '@/lib/utils/duration'

import type {
  CalculatedEditableItem,
  EditableItem,
  ReservationCalculations,
} from '../types'

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Build a human-readable label for the applied pricing discount.
 *
 * For rate-based products we show the percentage saved.
 * For tier-based products we show the tier threshold (e.g. "-20% (7+ j)").
 */
function buildTierLabel(
  item: EditableItem,
  discountPercent: number | null,
  duration: number,
): string | null {
  if (!discountPercent || discountPercent <= 0) return null

  // Rate-based: just show the percentage
  if (isRateBasedProduct({ basePeriodMinutes: item.basePeriodMinutes })) {
    return `-${Math.round(discountPercent)}%`
  }

  // Tier-based: find which tier was applied and show threshold
  const tiers = item.product?.pricingTiers
  if (!tiers?.length) return `-${Math.round(discountPercent)}%`

  const mode = item.pricingMode
  const unit = mode === 'hour' ? 'h' : mode === 'week' ? 'sem' : 'j'

  // Find the highest tier that applies to this duration
  const applicableTier = [...tiers]
    .sort((a, b) => b.minDuration - a.minDuration)
    .find((t) => duration >= t.minDuration)

  if (applicableTier && applicableTier.discountPercent > 0) {
    return `-${Math.round(applicableTier.discountPercent)}% (${applicableTier.minDuration}+ ${unit})`
  }

  return `-${Math.round(discountPercent)}%`
}

/**
 * Calculate the price for a single editable item using the shared pricing
 * utilities. Manual-price items use the user-set unit price directly.
 * Product-based items delegate to `calculateCartItemPrice` which handles
 * all pricing modes: seasonal, rate-based, tier-based, and fixed.
 */
function calculateEditableItemPrice(
  item: EditableItem,
  startDate: Date,
  endDate: Date,
): {
  totalPrice: number
  effectiveUnitPrice: number
  displayPricingMode: PricingMode
  tierLabel: string | null
  discount: number
  originalSubtotal: number
  savings: number
  discountPercent: number | null
  duration: number
} {
  const resolvePricingModeFromMinutes = (
    periodMinutes: number | null | undefined,
    fallback: PricingMode,
  ): PricingMode => {
    if (!periodMinutes || periodMinutes <= 0) {
      return fallback
    }

    const period = minutesToPriceDuration(periodMinutes)
    if (period.unit === 'week') return 'week'
    if (period.unit === 'day') return 'day'
    return 'hour'
  }

  const resolveRateDisplayPricingMode = (
    targetMinutes: number,
    fallback: PricingMode,
  ): PricingMode => {
    const periods = [
      item.product?.basePeriodMinutes ?? null,
      ...(item.product?.pricingTiers ?? []).map((tier) => tier.period ?? null),
    ]
      .filter((period): period is number => typeof period === 'number' && period > 0)
      .sort((a, b) => a - b)

    if (periods.length === 0) {
      return fallback
    }

    const applicablePeriod =
      [...periods].reverse().find((period) => period <= targetMinutes) ?? periods[0]

    return resolvePricingModeFromMinutes(applicablePeriod, fallback)
  }

  const mode = item.pricingMode
  const duration = calculateDuration(startDate, endDate, mode)

  // Manual price or custom item (no product): simple multiplication
  if (item.isManualPrice || !item.product) {
    const totalPrice = roundCurrency(item.unitPrice * duration * item.quantity)
    return {
      totalPrice,
      effectiveUnitPrice: item.unitPrice,
      displayPricingMode: item.pricingMode,
      tierLabel: null,
      discount: 0,
      originalSubtotal: totalPrice,
      savings: 0,
      discountPercent: null,
      duration,
    }
  }

  const product = item.product
  const startIso = startDate.toISOString()
  const endIso = endDate.toISOString()
  const durationMinutes = calculateDurationMinutes(startDate, endDate)

  // Delegate to the shared pricing utility — same logic as the storefront
  const result = calculateCartItemPrice(
    {
      price: parseFloat(product.price),
      deposit: parseFloat(product.deposit),
      quantity: item.quantity,
      startDate: startIso,
      endDate: endIso,
      pricingMode: mode,
      productPricingMode: (product.pricingMode as PricingMode) ?? mode,
      basePeriodMinutes: product.basePeriodMinutes ?? null,
      enforceStrictTiers: product.enforceStrictTiers ?? false,
      pricingTiers: product.pricingTiers.map((t) => ({
        id: t.id,
        minDuration: t.minDuration,
        discountPercent: t.discountPercent,
        period: t.period ?? null,
        price: t.price ?? null,
      })),
      seasonalPricings: product.seasonalPricings,
    },
    null,
    null,
  )

  const tierLabel = buildTierLabel(item, result.discountPercent, duration)

  const displayPricingMode = isRateBasedProduct({
    basePeriodMinutes: product.basePeriodMinutes,
  })
    ? resolveRateDisplayPricingMode(durationMinutes, mode)
    : mode
  const displayDuration = calculateDuration(startDate, endDate, displayPricingMode)

  // Derive an effective unit price for display (total / duration / quantity)
  const effectiveUnitPrice =
    displayDuration > 0 && item.quantity > 0
      ? result.subtotal / displayDuration / item.quantity
      : parseFloat(product.price)

  return {
    totalPrice: result.subtotal,
    effectiveUnitPrice,
    displayPricingMode,
    tierLabel,
    discount: result.discountPercent ?? 0,
    originalSubtotal: result.originalSubtotal,
    savings: result.savings,
    discountPercent: result.discountPercent,
    duration,
  }
}

interface UseEditReservationPricingParams {
  startDate: Date | undefined
  endDate: Date | undefined
  items: EditableItem[]
  originalSubtotal: number
  fixedChargesTotal?: number
}

export function useEditReservationPricing({
  startDate,
  endDate,
  items,
  originalSubtotal,
  fixedChargesTotal = 0,
}: UseEditReservationPricingParams) {
  const getDurationForMode = (mode: PricingMode) => {
    if (!startDate || !endDate) return 0
    return calculateDuration(startDate, endDate, mode)
  }

  const getDurationUnit = (mode: PricingMode) =>
    mode === 'hour' ? 'h' : mode === 'week' ? 'sem' : 'j'

  const newDuration = startDate && endDate
    ? calculateDuration(startDate, endDate, 'day')
    : 0

  const calculations = useMemo<ReservationCalculations>(() => {
    if (!startDate || !endDate) {
      return {
        items: items.map((item) => ({
          ...item,
          totalPrice: 0,
          duration: 0,
          effectiveUnitPrice: item.unitPrice,
          displayPricingMode: item.pricingMode,
          tierLabel: null,
          discount: 0,
          originalSubtotal: 0,
          savings: 0,
          discountPercent: null,
        })),
        subtotal: 0,
        deposit: 0,
        difference: -originalSubtotal,
        totalSavings: 0,
      }
    }

    const calculatedItems: CalculatedEditableItem[] = []
    let subtotal = 0
    let deposit = 0
    let totalSavings = 0

    for (const item of items) {
      const priceResult = calculateEditableItemPrice(item, startDate, endDate)

      calculatedItems.push({
        ...item,
        totalPrice: priceResult.totalPrice,
        duration: priceResult.duration,
        effectiveUnitPrice: priceResult.effectiveUnitPrice,
        displayPricingMode: priceResult.displayPricingMode,
        tierLabel: priceResult.tierLabel,
        discount: priceResult.discount,
        originalSubtotal: priceResult.originalSubtotal,
        savings: priceResult.savings,
        discountPercent: priceResult.discountPercent,
      })

      subtotal = roundCurrency(subtotal + priceResult.totalPrice)
      deposit = roundCurrency(deposit + item.depositPerUnit * item.quantity)
      totalSavings = roundCurrency(totalSavings + priceResult.savings)
    }

    const normalizedFixedCharges = Number.isFinite(fixedChargesTotal)
      ? fixedChargesTotal
      : 0
    const subtotalWithFixedCharges = roundCurrency(subtotal + normalizedFixedCharges)

    return {
      items: calculatedItems,
      subtotal: subtotalWithFixedCharges,
      deposit,
      difference: roundCurrency(subtotalWithFixedCharges - originalSubtotal),
      totalSavings,
    }
  }, [items, startDate, endDate, originalSubtotal, fixedChargesTotal])

  return {
    getDurationForMode,
    getDurationUnit,
    newDuration,
    calculations,
  }
}

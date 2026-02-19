import { useCallback, useMemo } from 'react'

import type { PricingMode } from '@louez/types'

import type {
  EditableItem,
  PricingTier,
  ReservationCalculations,
} from '../types'

function calculateDuration(startDate: Date, endDate: Date, pricingMode: PricingMode): number {
  const diffMs = endDate.getTime() - startDate.getTime()

  if (pricingMode === 'hour') {
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
  }

  if (pricingMode === 'week') {
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
  }

  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
}

function findApplicableTier(tiers: PricingTier[], duration: number): PricingTier | null {
  if (!tiers.length) return null

  const normalized = tiers
    .map((tier) => ({
      ...tier,
      minDuration: tier.minDuration ?? 1,
      discountPercent: tier.discountPercent ?? '0',
    }))
    .sort((a, b) => b.minDuration - a.minDuration)

  return normalized.find((tier) => duration >= tier.minDuration) || null
}

function calculateItemPrice(item: EditableItem, duration: number) {
  if (item.isManualPrice || !item.product) {
    return {
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * duration * item.quantity,
      tierLabel: null,
      discount: 0,
    }
  }

  const basePrice = parseFloat(item.product.price)
  const tier = findApplicableTier(item.product.pricingTiers, duration)

  if (tier) {
    const discount = parseFloat(tier.discountPercent ?? '0')
    const effectivePrice = basePrice * (1 - discount / 100)
    const unit = item.pricingMode === 'day' ? 'j' : item.pricingMode === 'hour' ? 'h' : 'sem'

    return {
      unitPrice: effectivePrice,
      totalPrice: effectivePrice * duration * item.quantity,
      tierLabel: `-${discount}% (${tier.minDuration}+ ${unit})`,
      discount,
    }
  }

  return {
    unitPrice: basePrice,
    totalPrice: basePrice * duration * item.quantity,
    tierLabel: null,
    discount: 0,
  }
}

interface UseEditReservationPricingParams {
  startDate: Date | undefined
  endDate: Date | undefined
  items: EditableItem[]
  originalSubtotal: number
}

export function useEditReservationPricing({
  startDate,
  endDate,
  items,
  originalSubtotal,
}: UseEditReservationPricingParams) {
  const getDurationForMode = useCallback(
    (mode: PricingMode) => {
      if (!startDate || !endDate) return 0
      return calculateDuration(startDate, endDate, mode)
    },
    [startDate, endDate]
  )

  const newDuration = useMemo(() => getDurationForMode('day'), [getDurationForMode])

  const getDurationUnit = useCallback(
    (mode: PricingMode) => (mode === 'hour' ? 'h' : mode === 'week' ? 'sem' : 'j'),
    []
  )

  const calculations = useMemo<ReservationCalculations>(() => {
    const aggregated = items.reduce<{
      items: ReservationCalculations['items']
      subtotal: number
      deposit: number
    }>(
      (accumulator, item) => {
        const itemDuration = getDurationForMode(item.pricingMode)
        const itemPrice = calculateItemPrice(item, itemDuration)

        accumulator.items.push({
          ...item,
          ...itemPrice,
          duration: itemDuration,
        })
        accumulator.subtotal += itemPrice.totalPrice
        accumulator.deposit += item.depositPerUnit * item.quantity
        return accumulator
      },
      { items: [], subtotal: 0, deposit: 0 }
    )

    return {
      items: aggregated.items,
      subtotal: aggregated.subtotal,
      deposit: aggregated.deposit,
      difference: aggregated.subtotal - originalSubtotal,
    }
  }, [items, getDurationForMode, originalSubtotal])

  return {
    getDurationForMode,
    getDurationUnit,
    newDuration,
    calculations,
  }
}

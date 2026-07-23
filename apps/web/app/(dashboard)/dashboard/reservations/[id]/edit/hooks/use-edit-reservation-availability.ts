import { useMemo } from 'react'
import { calculatePeakReservedQuantities } from '@louez/utils'

import type {
  AvailabilityWarning,
  EditableItem,
  ExistingReservation,
  Product,
} from '../types'

interface UseEditReservationAvailabilityParams {
  startDate: Date | undefined
  endDate: Date | undefined
  items: EditableItem[]
  products: Product[]
  existingReservations: ExistingReservation[]
  turnoverBufferMinutes: number
}

export function useEditReservationAvailability({
  startDate,
  endDate,
  items,
  products,
  existingReservations,
  turnoverBufferMinutes,
}: UseEditReservationAvailabilityParams) {
  const availabilityWarnings = useMemo<AvailabilityWarning[]>(() => {
    if (!startDate || !endDate || items.length === 0) {
      return []
    }

    const warnings: AvailabilityWarning[] = []
    const { reservedByProduct } = calculatePeakReservedQuantities({
      reservations: existingReservations,
      startDate,
      endDate,
      turnoverBufferMinutes,
    })

    for (const item of items) {
      if (!item.productId || !item.product) {
        continue
      }

      const reserved = reservedByProduct.get(item.productId) || 0
      const available = Math.max(0, item.product.quantity - reserved)

      if (item.quantity > available) {
        warnings.push({
          productId: item.productId,
          productName: item.productSnapshot.name,
          requestedQuantity: item.quantity,
          availableQuantity: available,
          turnoverBufferMinutes,
        })
      }
    }

    return warnings
  }, [endDate, existingReservations, items, startDate, turnoverBufferMinutes])

  // Remaining stock per product on the period, minus what the current edit already uses
  const availableQuantityByProduct = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>()
    if (!startDate || !endDate) {
      return map
    }

    const { reservedByProduct } = calculatePeakReservedQuantities({
      reservations: existingReservations,
      startDate,
      endDate,
      turnoverBufferMinutes,
    })

    for (const product of products) {
      const reserved = reservedByProduct.get(product.id) || 0
      const inCurrentItems = items
        .filter((item) => item.productId === product.id)
        .reduce((sum, item) => sum + item.quantity, 0)
      map.set(
        product.id,
        Math.max(0, product.quantity - reserved - inCurrentItems),
      )
    }

    return map
  }, [
    endDate,
    existingReservations,
    items,
    products,
    startDate,
    turnoverBufferMinutes,
  ])

  return {
    availabilityWarnings,
    availableQuantityByProduct,
  }
}

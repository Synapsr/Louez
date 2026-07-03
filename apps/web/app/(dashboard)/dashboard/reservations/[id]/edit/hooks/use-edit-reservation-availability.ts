import { useMemo } from 'react'
import { calculatePeakReservedQuantities } from '@louez/utils'

import type {
  AvailabilityWarning,
  EditableItem,
  ExistingReservation,
} from '../types'

interface UseEditReservationAvailabilityParams {
  startDate: Date | undefined
  endDate: Date | undefined
  items: EditableItem[]
  existingReservations: ExistingReservation[]
  turnoverBufferMinutes: number
}

export function useEditReservationAvailability({
  startDate,
  endDate,
  items,
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

  return {
    availabilityWarnings,
  }
}

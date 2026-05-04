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
}

export function useEditReservationAvailability({
  startDate,
  endDate,
  items,
  existingReservations,
}: UseEditReservationAvailabilityParams) {
  const availabilityWarnings = useMemo<AvailabilityWarning[]>(() => {
    if (!startDate || !endDate || items.length === 0) {
      return []
    }

    const warnings: AvailabilityWarning[] = []
    const { reservedByProduct } = calculatePeakReservedQuantities({
      reservations: existingReservations.filter((reservation) =>
        ['pending', 'confirmed', 'ongoing'].includes(reservation.status),
      ),
      startDate,
      endDate,
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
        })
      }
    }

    return warnings
  }, [endDate, existingReservations, items, startDate])

  return {
    availabilityWarnings,
  }
}

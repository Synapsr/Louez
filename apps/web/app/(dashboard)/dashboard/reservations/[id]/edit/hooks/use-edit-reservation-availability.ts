import { useMemo } from 'react'

import { dateRangesOverlap } from '@/lib/utils/duration'

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
    const reservedByProduct = new Map<string, number>()

    for (const reservation of existingReservations) {
      if (!['pending', 'confirmed', 'ongoing'].includes(reservation.status)) {
        continue
      }

      if (dateRangesOverlap(reservation.startDate, reservation.endDate, startDate, endDate)) {
        for (const item of reservation.items) {
          if (!item.productId) continue

          const currentQuantity = reservedByProduct.get(item.productId) || 0
          reservedByProduct.set(item.productId, currentQuantity + item.quantity)
        }
      }
    }

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

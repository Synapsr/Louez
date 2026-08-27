import type { StockKind } from '@louez/types'

import { DEFAULT_COMBINATION_KEY } from './variants'

export interface AvailabilityReservationItem {
  productId: string | null
  combinationKey?: string | null
  quantity: number
  stockKind?: StockKind
  consumedQuantity?: number
}

export interface AvailabilityReservation {
  status?: string
  startDate: Date
  endDate: Date
  items: AvailabilityReservationItem[]
}

export interface PeakReservedQuantities {
  reservedByProduct: Map<string, number>
  reservedByProductCombination: Map<string, number>
}

export function getProductCombinationAvailabilityKey(
  productId: string,
  combinationKey?: string | null,
): string {
  return `${productId}:${combinationKey || DEFAULT_COMBINATION_KEY}`
}

function addDelta(
  deltas: Map<string, Map<number, number>>,
  key: string,
  timestamp: number,
  quantity: number,
) {
  const keyDeltas = deltas.get(key) || new Map<number, number>()
  keyDeltas.set(timestamp, (keyDeltas.get(timestamp) || 0) + quantity)
  deltas.set(key, keyDeltas)
}

function calculatePeakByKey(deltas: Map<string, Map<number, number>>) {
  const peakByKey = new Map<string, number>()

  for (const [key, keyDeltas] of deltas.entries()) {
    let current = 0
    let peak = 0

    for (const timestamp of [...keyDeltas.keys()].sort((a, b) => a - b)) {
      current += keyDeltas.get(timestamp) || 0
      peak = Math.max(peak, current)
    }

    peakByKey.set(key, peak)
  }

  return peakByKey
}

export function calculatePeakReservedQuantities(params: {
  reservations: AvailabilityReservation[]
  startDate: Date
  endDate: Date
  turnoverBufferMinutes?: number
  pendingBlocksAvailability?: boolean
}): PeakReservedQuantities {
  const productDeltas = new Map<string, Map<number, number>>()
  const combinationDeltas = new Map<string, Map<number, number>>()
  const consumableReservedByProduct = new Map<string, number>()
  const requestedStart = params.startDate.getTime()
  const bufferMs = Math.max(0, params.turnoverBufferMinutes ?? 0) * 60 * 1000
  const requestedEnd = params.endDate.getTime() + bufferMs

  for (const reservation of params.reservations) {
    if (reservation.status === 'pending' && params.pendingBlocksAvailability === false) {
      continue
    }

    for (const item of reservation.items) {
      if (!item.productId || item.stockKind !== 'consumable') {
        continue
      }

      const heldQuantity = Math.max(0, item.quantity - (item.consumedQuantity ?? 0))
      consumableReservedByProduct.set(
        item.productId,
        (consumableReservedByProduct.get(item.productId) ?? 0) + heldQuantity,
      )
    }

    const overlapStart = Math.max(reservation.startDate.getTime(), requestedStart)
    const overlapEnd = Math.min(reservation.endDate.getTime() + bufferMs, requestedEnd)

    if (overlapStart >= overlapEnd) {
      continue
    }

    for (const item of reservation.items) {
      if (!item.productId || item.stockKind === 'consumable') {
        continue
      }

      addDelta(productDeltas, item.productId, overlapStart, item.quantity)
      addDelta(productDeltas, item.productId, overlapEnd, -item.quantity)

      const combinationKey = getProductCombinationAvailabilityKey(
        item.productId,
        item.combinationKey,
      )
      addDelta(combinationDeltas, combinationKey, overlapStart, item.quantity)
      addDelta(combinationDeltas, combinationKey, overlapEnd, -item.quantity)
    }
  }

  const reservedByProduct = calculatePeakByKey(productDeltas)
  for (const [productId, quantity] of consumableReservedByProduct) {
    reservedByProduct.set(productId, quantity)
  }

  return {
    reservedByProduct,
    reservedByProductCombination: calculatePeakByKey(combinationDeltas),
  }
}

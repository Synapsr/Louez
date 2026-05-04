import { DEFAULT_COMBINATION_KEY } from './variants'

export interface AvailabilityReservationItem {
  productId: string | null
  combinationKey?: string | null
  quantity: number
}

export interface AvailabilityReservation {
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
}): PeakReservedQuantities {
  const productDeltas = new Map<string, Map<number, number>>()
  const combinationDeltas = new Map<string, Map<number, number>>()
  const requestedStart = params.startDate.getTime()
  const requestedEnd = params.endDate.getTime()

  for (const reservation of params.reservations) {
    const overlapStart = Math.max(reservation.startDate.getTime(), requestedStart)
    const overlapEnd = Math.min(reservation.endDate.getTime(), requestedEnd)

    if (overlapStart >= overlapEnd) {
      continue
    }

    for (const item of reservation.items) {
      if (!item.productId) {
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

  return {
    reservedByProduct: calculatePeakByKey(productDeltas),
    reservedByProductCombination: calculatePeakByKey(combinationDeltas),
  }
}

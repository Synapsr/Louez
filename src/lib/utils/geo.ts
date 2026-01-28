import type { DeliverySettings } from '@/types/store'

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Calculate distance between two points using Haversine formula
 * @param lat1 - Latitude of point 1
 * @param lon1 - Longitude of point 1
 * @param lat2 - Latitude of point 2
 * @param lon2 - Longitude of point 2
 * @returns Distance in kilometers
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371 // Earth's radius in km

  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

/**
 * Calculate delivery fee based on distance and settings
 * @param distanceKm - Distance in kilometers
 * @param settings - Delivery settings from store
 * @param orderSubtotal - Order subtotal for free delivery threshold check
 * @returns Delivery fee in store currency
 */
export function calculateDeliveryFee(
  distanceKm: number,
  settings: DeliverySettings,
  orderSubtotal: number
): number {
  // Check free delivery threshold
  if (
    settings.freeDeliveryThreshold !== null &&
    orderSubtotal >= settings.freeDeliveryThreshold
  ) {
    return 0
  }

  // Calculate effective distance (double if round-trip)
  const effectiveDistance = settings.roundTrip ? distanceKm * 2 : distanceKm

  // Calculate fee based on distance
  const calculatedFee = effectiveDistance * settings.pricePerKm

  // Apply minimum fee
  return Math.max(calculatedFee, settings.minimumFee)
}

/**
 * Validate if delivery is possible for given distance
 * @param distanceKm - Distance in kilometers
 * @param settings - Delivery settings from store
 * @returns Validation result with error message if invalid
 */
export function validateDelivery(
  distanceKm: number,
  settings: DeliverySettings
): { valid: boolean; error?: string } {
  if (!settings.enabled) {
    return { valid: false, error: 'Delivery is not enabled for this store' }
  }

  if (
    settings.maximumDistance !== null &&
    distanceKm > settings.maximumDistance
  ) {
    return {
      valid: false,
      error: `Delivery not available beyond ${settings.maximumDistance} km`,
    }
  }

  return { valid: true }
}

/**
 * Check if free delivery applies for given order
 * @param orderSubtotal - Order subtotal
 * @param settings - Delivery settings from store
 * @returns True if free delivery applies
 */
export function isFreeDelivery(
  orderSubtotal: number,
  settings: DeliverySettings
): boolean {
  return (
    settings.freeDeliveryThreshold !== null &&
    orderSubtotal >= settings.freeDeliveryThreshold
  )
}

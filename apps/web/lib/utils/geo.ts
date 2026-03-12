import type { DeliverySettings } from '@louez/types'

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

// ---------------------------------------------------------------------------
// Per-leg fee calculation (new model)
// ---------------------------------------------------------------------------

/**
 * Calculate fee for a single delivery leg (outbound or return).
 * Minimum fee is applied per leg.
 *
 * @param distanceKm - Distance in kilometers for this leg
 * @param settings - Delivery settings from store
 * @returns Fee for this leg in store currency
 */
export function calculateLegFee(
  distanceKm: number,
  settings: DeliverySettings
): number {
  const fee = distanceKm * settings.pricePerKm
  return Math.round(Math.max(fee, settings.minimumFee) * 100) / 100
}

/**
 * Calculate total delivery fee for both legs.
 * Free delivery threshold applies to the total order subtotal.
 * Each non-zero leg has the minimum fee applied independently.
 *
 * @param outboundDistanceKm - Store → outbound address (null if at store)
 * @param returnDistanceKm - Store → return address (null if at store)
 * @param settings - Delivery settings from store
 * @param orderSubtotal - Order subtotal for free delivery threshold check
 * @returns Per-leg and total fees
 */
export function calculateTotalDeliveryFee(
  outboundDistanceKm: number | null,
  returnDistanceKm: number | null,
  settings: DeliverySettings,
  orderSubtotal: number
): { outboundFee: number; returnFee: number; totalFee: number } {
  // Free delivery threshold applies to total order
  if (
    settings.freeDeliveryThreshold !== null &&
    orderSubtotal >= settings.freeDeliveryThreshold
  ) {
    return { outboundFee: 0, returnFee: 0, totalFee: 0 }
  }

  const outboundFee =
    outboundDistanceKm !== null ? calculateLegFee(outboundDistanceKm, settings) : 0
  const returnFee =
    returnDistanceKm !== null ? calculateLegFee(returnDistanceKm, settings) : 0

  return {
    outboundFee,
    returnFee,
    totalFee: Math.round((outboundFee + returnFee) * 100) / 100,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate if delivery is possible for given distance
 * @param distanceKm - Distance in kilometers
 * @param settings - Delivery settings from store
 * @returns Validation result with i18n error key if invalid
 */
export function validateDelivery(
  distanceKm: number,
  settings: DeliverySettings
): { valid: boolean; errorKey?: string; errorParams?: Record<string, unknown> } {
  if (!settings.enabled) {
    return { valid: false, errorKey: 'errors.deliveryNotEnabled' }
  }

  if (
    settings.maximumDistance !== null &&
    distanceKm > settings.maximumDistance
  ) {
    return {
      valid: false,
      errorKey: 'errors.deliveryTooFar',
      errorParams: { maxDistance: settings.maximumDistance },
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

import type { ReservationLocationSnapshot } from '@louez/types'

import { formatLocationAddress } from '@/lib/reservations/format-location-address'

export interface StoreLegLocation {
  name: string
  address: string | null
}

interface LocationOptionLike {
  id: string | null
  name: string
  address: string | null
  city: string | null
  postalCode: string | null
}

export function storeLegLocationFromSnapshot(
  snapshot: ReservationLocationSnapshot,
): StoreLegLocation {
  return { name: snapshot.name, address: formatLocationAddress(snapshot) }
}

export function resolveStoreLegLocation({
  locations,
  selectedLocationId,
  storeAddress,
  fallbackName,
}: {
  locations: LocationOptionLike[]
  selectedLocationId: string | null
  storeAddress: string | null | undefined
  fallbackName: string
}): StoreLegLocation {
  const selected =
    locations.find((location) => location.id === selectedLocationId) ??
    locations[0] ??
    null

  if (!selected) {
    return { name: fallbackName, address: storeAddress ?? null }
  }

  return { name: selected.name, address: formatLocationAddress(selected) }
}

export function isSameStoreLegLocation(
  pickup: StoreLegLocation,
  returnLocation: StoreLegLocation,
): boolean {
  return pickup.name === returnLocation.name && pickup.address === returnLocation.address
}

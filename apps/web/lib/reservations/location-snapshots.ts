import { and, eq } from 'drizzle-orm';

import { db, storeLocations } from '@louez/db';
import type { ReservationLocationSnapshot } from '@louez/types';

interface StoreForLocationSnapshot {
  id: string;
  name: string;
  address: string | null;
  latitude?: string | null;
  longitude?: string | null;
  settings?: {
    country?: string;
  } | null;
}

export function buildPrimaryLocationSnapshot(
  store: StoreForLocationSnapshot,
): ReservationLocationSnapshot {
  return {
    type: 'primary',
    name: store.name,
    address: store.address,
    city: null,
    postalCode: null,
    country: store.settings?.country ?? 'FR',
    latitude: store.latitude ? parseFloat(store.latitude) : null,
    longitude: store.longitude ? parseFloat(store.longitude) : null,
  };
}

export async function resolveReservationLocationSnapshot({
  store,
  locationId,
  requireActive = true,
}: {
  store: StoreForLocationSnapshot;
  locationId?: string | null;
  requireActive?: boolean;
}): Promise<{
  locationId: string | null;
  snapshot: ReservationLocationSnapshot;
}> {
  if (!locationId) {
    return {
      locationId: null,
      snapshot: buildPrimaryLocationSnapshot(store),
    };
  }

  const location = await db.query.storeLocations.findFirst({
    where: and(
      eq(storeLocations.id, locationId),
      eq(storeLocations.storeId, store.id),
    ),
  });

  if (!location) {
    throw new Error('errors.locationNotFound');
  }

  if (requireActive && !location.isActive) {
    throw new Error('errors.locationInactive');
  }

  return {
    locationId: location.id,
    snapshot: {
      type: 'additional',
      name: location.name,
      address: location.address,
      city: location.city,
      postalCode: location.postalCode,
      country: location.country ?? store.settings?.country ?? 'FR',
      latitude: location.latitude ? parseFloat(location.latitude) : null,
      longitude: location.longitude ? parseFloat(location.longitude) : null,
    },
  };
}

export function formatLocationSnapshotAddress(
  snapshot: ReservationLocationSnapshot | null | undefined,
): string | null {
  if (!snapshot) {
    return null;
  }

  return [
    snapshot.address,
    [snapshot.postalCode, snapshot.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ') || null;
}

export function formatReservationRouteLabel({
  outboundMethod,
  returnMethod,
  pickupLocationSnapshot,
  returnLocationSnapshot,
  deliveryLabel = 'Livraison',
  collectionLabel = 'Recuperation',
  fallbackLocationLabel = 'Boutique',
}: {
  outboundMethod?: string | null;
  returnMethod?: string | null;
  pickupLocationSnapshot?: ReservationLocationSnapshot | null;
  returnLocationSnapshot?: ReservationLocationSnapshot | null;
  deliveryLabel?: string;
  collectionLabel?: string;
  fallbackLocationLabel?: string;
}): string {
  const pickupLabel =
    outboundMethod === 'address'
      ? deliveryLabel
      : pickupLocationSnapshot?.name || fallbackLocationLabel;
  const returnLabel =
    returnMethod === 'address'
      ? collectionLabel
      : returnLocationSnapshot?.name || pickupLocationSnapshot?.name || fallbackLocationLabel;

  if (pickupLabel === returnLabel) {
    return pickupLabel;
  }

  return `${pickupLabel} -> ${returnLabel}`;
}

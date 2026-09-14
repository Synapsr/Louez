import type { MyLocation } from "@/hooks/use-my-location";
import { calculateHaversineDistance } from "@/lib/utils/geo";

import type { CheckoutLocationOption } from "./checkout.types";

/** The primary store has no row of its own, so it needs a stand-in key. */
export const PRIMARY_LOCATION_KEY = "primary";

export const toLocationKey = (id: string | null) => id ?? PRIMARY_LOCATION_KEY;
export const fromLocationKey = (key: string) => (key === PRIMARY_LOCATION_KEY ? null : key);

export interface CheckoutLocation {
  key: string;
  /** Position in the list as displayed, shared with the map pin. */
  number: string;
  name: string;
  /** Street, postal code and city on one line. */
  fullAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Kilometres from the customer, once we know where they are. */
  distanceKm: number | null;
}

/**
 * Turn the store's locations into rows ready to render: one address line, the
 * distance from the customer when known, nearest first, and a number that ties
 * each row to its pin on the map.
 */
export const buildCheckoutLocations = (
  locations: CheckoutLocationOption[],
  customerPosition: MyLocation | null,
): CheckoutLocation[] => {
  const withDistance = locations.map((location) => {
    const locality = [location.postalCode, location.city].filter(Boolean).join(" ");
    const fullAddress = [location.address, locality].filter(Boolean).join(", ") || null;

    return {
      key: toLocationKey(location.id),
      name: location.name,
      fullAddress,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      distanceKm:
        customerPosition && location.latitude != null && location.longitude != null
          ? calculateHaversineDistance(
              customerPosition.latitude,
              customerPosition.longitude,
              location.latitude,
              location.longitude,
            )
          : null,
    };
  });

  const ordered = customerPosition
    ? [...withDistance].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    : withDistance;

  return ordered.map((location, rank) => ({ ...location, number: String(rank + 1) }));
};

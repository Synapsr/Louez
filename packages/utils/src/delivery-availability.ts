import type { DeliverySettings } from "@louez/types";

/**
 * How a store hands its rentals over, as checkout reads its delivery
 * settings: the storefront's checkout, the server that checks a booking and
 * the launch checklist share it.
 */

type Coordinate = number | string | null | undefined;

const toCoordinate = (value: Coordinate): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Whether the store's coordinates are set and on the map: address delivery is measured from them. */
export function hasUsableStoreCoordinates(latitude: Coordinate, longitude: Coordinate): boolean {
  const lat = toCoordinate(latitude);
  const lng = toCoordinate(longitude);
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export interface DeliveryAvailability {
  /** Delivery to an address can be booked: delivery is on and the store has usable coordinates. */
  addressDelivery: boolean;
  /**
   * Delivery is on in a delivery-only mode (required, included): the server
   * refuses a booking collected at the store or a pickup point.
   */
  deliveryOnly: boolean;
  /** Delivery is free, included in the price. */
  deliveryIncluded: boolean;
  /** Customers may choose among the store's pickup points. */
  multiLocation: boolean;
}

export function getDeliveryAvailability(
  settings: DeliverySettings | null | undefined,
  store: { latitude: Coordinate; longitude: Coordinate },
): DeliveryAvailability {
  const mode = settings?.mode ?? "optional";
  return {
    addressDelivery: Boolean(
      settings?.enabled && hasUsableStoreCoordinates(store.latitude, store.longitude),
    ),
    deliveryOnly: Boolean(settings?.enabled) && (mode === "required" || mode === "included"),
    deliveryIncluded: mode === "included",
    multiLocation: Boolean(settings?.multiLocationEnabled),
  };
}

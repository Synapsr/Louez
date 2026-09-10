import type { LegMethod } from "@louez/types";

import type { MyLocation } from "@/hooks/use-my-location";
import { directionsUrl } from "@/lib/utils/maps-links";

import type { DeliveryAddress } from "./checkout.types";
import type {
  FulfillmentMapPin,
  FulfillmentMapRadius,
} from "./components/checkout-fulfillment-map";
import { toLocationKey, type CheckoutLocation } from "./util.checkout-locations";

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface BuildLegMapInput {
  method: LegMethod;
  locations: CheckoutLocation[];
  selectedLocationId: string | null;
  address: DeliveryAddress;
  /** The store the delivery fee is measured from. */
  origin: Coordinates | null;
  originLabel: string;
  customerPosition: MyLocation | null;
  customerLabel: string;
  maximumDistance: number | null;
}

export interface LegMapView {
  pins: FulfillmentMapPin[];
  selectedId: string | null;
  radius: FulfillmentMapRadius | null;
  link: { from: [number, number]; to: [number, number] } | null;
  directionsHref: string | null;
}

const hasCoordinates = (value: {
  latitude: number | null;
  longitude: number | null;
}): value is { latitude: number; longitude: number } =>
  value.latitude !== null && value.longitude !== null;

/**
 * What the map shows for one leg: the store's locations when the customer
 * collects, or the delivery area with the store and the destination when it is
 * brought to them. The customer's own position is added either way, once known.
 */
export const buildLegMapView = ({
  method,
  locations,
  selectedLocationId,
  address,
  origin,
  originLabel,
  customerPosition,
  customerLabel,
  maximumDistance,
}: BuildLegMapInput): LegMapView => {
  const isDelivery = method === "address";
  const pins: FulfillmentMapPin[] = [];

  if (isDelivery) {
    if (origin) {
      pins.push({
        id: "origin",
        latitude: origin.latitude,
        longitude: origin.longitude,
        label: originLabel,
        kind: "origin",
      });
    }
    if (hasCoordinates(address)) {
      pins.push({
        id: "destination",
        latitude: address.latitude,
        longitude: address.longitude,
        label: address.address,
        kind: "destination",
      });
    }
  } else {
    for (const location of locations) {
      if (location.latitude === null || location.longitude === null) continue;
      pins.push({
        id: location.key,
        latitude: location.latitude,
        longitude: location.longitude,
        label: location.name,
        badge: location.number,
        kind: "location",
      });
    }
  }

  if (customerPosition) {
    pins.push({
      id: "customer",
      latitude: customerPosition.latitude,
      longitude: customerPosition.longitude,
      label: customerLabel,
      kind: "customer",
    });
  }

  const selectedKey = toLocationKey(selectedLocationId);
  const selectedLocation = locations.find((location) => location.key === selectedKey);

  return {
    pins,
    selectedId: isDelivery ? null : selectedKey,
    radius:
      isDelivery && origin && maximumDistance !== null
        ? { latitude: origin.latitude, longitude: origin.longitude, km: maximumDistance }
        : null,
    link:
      isDelivery && origin && hasCoordinates(address)
        ? {
            from: [origin.longitude, origin.latitude],
            to: [address.longitude, address.latitude],
          }
        : null,
    directionsHref:
      !isDelivery && selectedLocation?.fullAddress
        ? directionsUrl(selectedLocation.fullAddress)
        : null,
  };
};

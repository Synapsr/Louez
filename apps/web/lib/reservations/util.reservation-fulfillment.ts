import type { ReservationLocationSnapshot } from "@louez/types";

import { formatLocationAddress } from "./format-location-address";

/** The two moments a customer has to be somewhere: collecting, then giving back. */
export type FulfillmentLeg = "pickup" | "dropoff";

/** A leg happens either at one of the store's locations, or at the customer's address. */
export interface FulfillmentPlace {
  kind: "store" | "address";
  /** Store location name; null when the leg happens at the customer's address. */
  name: string | null;
  /** Street, postal code and city on one line. */
  address: string | null;
}

export interface ReservationFulfillment {
  pickup: FulfillmentPlace;
  dropoff: FulfillmentPlace;
  /** True when the equipment goes back exactly where it was collected. */
  isSamePlace: boolean;
}

interface FulfillmentReservation {
  outboundMethod?: string | null;
  returnMethod?: string | null;
  /** Legacy round-trip flag, still the only signal on rows older than the legs. */
  deliveryOption?: string | null;
  deliveryAddress?: string | null;
  deliveryCity?: string | null;
  deliveryPostalCode?: string | null;
  returnAddress?: string | null;
  returnCity?: string | null;
  returnPostalCode?: string | null;
  pickupLocationSnapshot?: ReservationLocationSnapshot | null;
  returnLocationSnapshot?: ReservationLocationSnapshot | null;
}

interface FulfillmentStore {
  name: string;
  address: string | null;
}

const toStorePlace = (
  snapshot: ReservationLocationSnapshot | null | undefined,
  store: FulfillmentStore,
): FulfillmentPlace =>
  snapshot
    ? { kind: "store", name: snapshot.name, address: formatLocationAddress(snapshot) }
    : { kind: "store", name: store.name, address: store.address };

const toAddressPlace = (address: string | null): FulfillmentPlace => ({
  kind: "address",
  name: null,
  address,
});

const isSamePlace = (pickup: FulfillmentPlace, dropoff: FulfillmentPlace): boolean =>
  pickup.kind === dropoff.kind &&
  pickup.name === dropoff.name &&
  pickup.address === dropoff.address;

/**
 * Where the customer collects the equipment and where they bring it back — the
 * one answer the reservation page and its calendar event both need.
 *
 * Store legs read their snapshot, so a location renamed or moved since booking
 * still shows the address the customer was given. Rows booked before the legs
 * existed only carry `deliveryOption`, so a delivery there counts as an
 * outbound address leg, matching what the store's own calendar shows.
 */
export const resolveReservationFulfillment = ({
  reservation,
  store,
}: {
  reservation: FulfillmentReservation;
  store: FulfillmentStore;
}): ReservationFulfillment => {
  const deliveryAddress = formatLocationAddress({
    address: reservation.deliveryAddress,
    city: reservation.deliveryCity,
    postalCode: reservation.deliveryPostalCode,
  });
  const returnAddress = formatLocationAddress({
    address: reservation.returnAddress,
    city: reservation.returnCity,
    postalCode: reservation.returnPostalCode,
  });

  const isDelivered =
    reservation.outboundMethod === "address" ||
    (reservation.outboundMethod !== "address" &&
      reservation.deliveryOption === "delivery" &&
      Boolean(deliveryAddress));
  const isCollected = reservation.returnMethod === "address";

  const pickup = isDelivered
    ? toAddressPlace(deliveryAddress)
    : toStorePlace(reservation.pickupLocationSnapshot, store);
  const dropoff = isCollected
    ? toAddressPlace(returnAddress ?? deliveryAddress)
    : toStorePlace(reservation.returnLocationSnapshot ?? reservation.pickupLocationSnapshot, store);

  return { pickup, dropoff, isSamePlace: isSamePlace(pickup, dropoff) };
};

/**
 * Which `storefront.account.fulfillment` key names the place, or null when the
 * store location carries its own name.
 */
export const getFulfillmentPlaceKey = (
  place: FulfillmentPlace,
  leg: FulfillmentLeg,
): "deliveredToYou" | "collectedFromYou" | "storeFallback" | null => {
  if (place.kind === "address") return leg === "pickup" ? "deliveredToYou" : "collectedFromYou";
  return place.name ? null : "storeFallback";
};

/** One-line place for a calendar field: what it is called, then where it is. */
export const formatFulfillmentPlaceLine = (place: FulfillmentPlace, name: string): string =>
  [name, place.address].filter(Boolean).join(" — ");

import type { AddressDetails } from "@louez/types";

import type { DeliveryAddress } from "./checkout.types";

export interface CustomerAddressFields {
  address: string;
  postalCode: string;
  city: string;
}

type Coordinates = Pick<DeliveryAddress, "latitude" | "longitude">;

/** A suggestion the customer picked: what it filled, and where it is. */
export interface CustomerAddressPick {
  fields: CustomerAddressFields;
  latitude: number;
  longitude: number;
}

const NO_COORDINATES: Coordinates = { latitude: null, longitude: null };

export const getCustomerAddressFields = (details: AddressDetails): CustomerAddressFields => {
  const streetAddress = `${details.streetNumber ?? ""} ${details.street ?? ""}`.trim();

  return {
    address: streetAddress || details.formattedAddress.trim(),
    postalCode: details.postalCode?.trim() ?? "",
    city: details.city?.trim() ?? "",
  };
};

/**
 * The picked address's coordinates, while the street, the postal code and the
 * city still hold what the pick filled; none once any of them differs.
 */
export const getPickedCoordinates = (
  pick: CustomerAddressPick | null,
  values: CustomerAddressFields,
): Coordinates =>
  pick &&
  pick.fields.address === values.address &&
  pick.fields.postalCode === values.postalCode &&
  pick.fields.city === values.city
    ? { latitude: pick.latitude, longitude: pick.longitude }
    : NO_COORDINATES;

/**
 * What a delivery or collection address starts from: the customer's own. A
 * picked address comes with its coordinates; one typed, or saved without a
 * pick, comes as its text alone, street, postal code and city, so the field
 * asks for a choice and searches that text when it is focused. Nothing when
 * the customer gave no street.
 */
export const getDeliveryPrefill = (
  pick: CustomerAddressPick | null,
  values: CustomerAddressFields,
): (Coordinates & { address: string }) | null => {
  if (!values.address.trim()) return null;
  const coordinates = getPickedCoordinates(pick, values);
  if (coordinates.latitude !== null && coordinates.longitude !== null) {
    return { address: values.address, ...coordinates };
  }
  const locality = [values.postalCode.trim(), values.city.trim()].filter(Boolean).join(" ");
  return {
    address: [values.address.trim(), locality].filter(Boolean).join(", "),
    ...NO_COORDINATES,
  };
};

/**
 * The postal code and the city once the street is edited: a value the pick
 * filled goes stale and is cleared; one typed or autofilled is kept.
 */
export const getLocalityAfterStreetEdit = (
  pick: CustomerAddressPick | null,
  values: CustomerAddressFields,
): Pick<CustomerAddressFields, "postalCode" | "city"> => ({
  postalCode: pick && values.postalCode === pick.fields.postalCode ? "" : values.postalCode,
  city: pick && values.city === pick.fields.city ? "" : values.city,
});

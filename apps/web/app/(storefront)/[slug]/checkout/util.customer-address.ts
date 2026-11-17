import type { AddressDetails } from "@louez/types";

interface CustomerAddressFields {
  address: string;
  postalCode: string;
  city: string;
}

export const getCustomerAddressFields = (details: AddressDetails): CustomerAddressFields => {
  const streetAddress = `${details.streetNumber ?? ""} ${details.street ?? ""}`.trim();

  return {
    address: streetAddress || details.formattedAddress.trim(),
    postalCode: details.postalCode?.trim() ?? "",
    city: details.city?.trim() ?? "",
  };
};

/**
 * The customer's own address keeps what they typed: leaving the field never
 * looks it up, only a suggestion they pick replaces it.
 */
export const CUSTOMER_ADDRESS_RESOLVES_TYPED_TEXT = false;

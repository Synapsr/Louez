import type { AddressDetails } from '@louez/types';

interface CustomerAddressFields {
  address: string;
  postalCode: string;
  city: string;
}

export const getCustomerAddressFields = (
  details: AddressDetails,
): CustomerAddressFields => {
  const streetAddress =
    `${details.streetNumber ?? ''} ${details.street ?? ''}`.trim();

  return {
    address: streetAddress || details.formattedAddress.trim(),
    postalCode: details.postalCode?.trim() ?? '',
    city: details.city?.trim() ?? '',
  };
};

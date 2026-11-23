import type { AddressDetails } from "@louez/types";

import type { AddressInputSource } from "@/components/ui/address-input";
import { calculateHaversineDistance } from "@/lib/utils/geo";

/**
 * The checkout of a demo store (lib/demo) looks addresses up in its trade's
 * own short list and measures distances in a straight line: a visitor never
 * sets off a paid address or routing call. Whatever is typed, the list is
 * offered, matches first.
 */

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function createDemoAddressSource(addresses: readonly AddressDetails[]): AddressInputSource {
  return {
    search: (query) => {
      const typed = normalize(query);
      if (!typed) return [];
      const matches = (address: AddressDetails) =>
        normalize(address.formattedAddress).includes(typed);
      return [...addresses]
        .sort((a, b) => Number(matches(b)) - Number(matches(a)))
        .map((address) => ({
          placeId: address.placeId,
          description: address.formattedAddress,
          mainText: [address.streetNumber, address.street].filter(Boolean).join(" "),
          secondaryText: [address.postalCode, address.city].filter(Boolean).join(" "),
        }));
    },
    details: (placeId) => addresses.find((address) => address.placeId === placeId) ?? null,
  };
}

export const straightLineDistanceKm = (params: {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
}): number =>
  Math.round(
    calculateHaversineDistance(
      params.originLatitude,
      params.originLongitude,
      params.destinationLatitude,
      params.destinationLongitude,
    ) * 100,
  ) / 100;

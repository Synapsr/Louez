import type { LegMethod } from "@louez/types";

/** A delivery leg as a reservation stores it: its method as text, its coordinates as decimals. */
export interface StoredDeliveryLeg {
  method: string | null;
  address: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
}

/** A delivery leg as the edit sends it. */
export interface EditedDeliveryLeg {
  method: LegMethod;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** A coordinate as the reservation stores it, seven decimals, whatever way it was written. */
const coordinate = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(7)) : null;
};
const text = (value: string | null | undefined) => (value ? value : null);

const hasPlace = (leg: { latitude?: string | number | null; longitude?: string | number | null }) =>
  coordinate(leg.latitude) !== null && coordinate(leg.longitude) !== null;

/** Whether the edit sends the leg as it is stored: the same method, address text and place. */
export const isDeliveryLegKept = (stored: StoredDeliveryLeg, edited: EditedDeliveryLeg) =>
  (stored.method ?? "store") === edited.method &&
  (edited.method !== "address" ||
    (text(stored.address) === text(edited.address) &&
      coordinate(stored.latitude) === coordinate(edited.latitude) &&
      coordinate(stored.longitude) === coordinate(edited.longitude)));

/**
 * Whether the edit sends the leg to an address, or to another one, with no
 * place chosen: it cannot be measured, so it cannot be priced. A leg kept as
 * stored never is, even one saved long ago without its place.
 */
export const needsChosenAddress = (stored: StoredDeliveryLeg, edited: EditedDeliveryLeg) =>
  edited.method === "address" && !hasPlace(edited) && !isDeliveryLegKept(stored, edited);

/** Whether a stored leg goes to an address the reservation holds no place for. */
export const isUnmeasuredAddressLeg = (stored: StoredDeliveryLeg) =>
  stored.method === "address" && !hasPlace(stored);

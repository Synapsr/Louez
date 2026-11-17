/** A delivery leg as the edit form holds it, or as the edit sends it. */
export interface DeliveryLegPlace {
  method: string;
  latitude?: number | null;
  longitude?: number | null;
}

const isCoordinate = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Whether a leg goes to an address with no place chosen. Such a leg has no
 * distance, so any save would price it at zero: the edit saves no address
 * leg without both coordinates, whether it changed it or not. A coordinate
 * of 0 is a coordinate.
 */
export const lacksChosenPlace = (leg: DeliveryLegPlace) =>
  leg.method === "address" && !(isCoordinate(leg.latitude) && isCoordinate(leg.longitude));

import { getRouteDistance } from "@louez/api/services";
import type { DeliverySettings } from "@louez/types";
import type { CreateReservationDeliveryLegInput } from "@louez/validations";

import { resolveReservationLocationSnapshot } from "@/lib/reservations/location-snapshots";
import {
  calculateTotalDeliveryFee,
  isDeliveryOrderAmountEligible,
  validateDelivery,
} from "@/lib/utils/geo";

import {
  failReservation,
  type ReservationErrorParams,
  type ReservationFailure,
} from "./reservation.types";

type LocationSnapshot = Awaited<ReturnType<typeof resolveReservationLocationSnapshot>>;

interface DeliveryStore {
  id: string;
  name: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  settings: { country?: string } | null;
}

export interface ResolvedDelivery {
  settings: DeliverySettings | undefined;
  outboundLeg: CreateReservationDeliveryLegInput | undefined;
  returnLeg: CreateReservationDeliveryLegInput | undefined;
  hasOutboundDelivery: boolean;
  hasReturnDelivery: boolean;
  hasAnyDelivery: boolean;
  fee: number;
  outboundDistanceKm: number | null;
  returnDistanceKm: number | null;
  pickupLocation: LocationSnapshot | null;
  returnLocation: LocationSnapshot | null;
}

const getErrorKey = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.startsWith("errors.") ? error.message : fallback;

const isCoordinateInRange = (latitude: number, longitude: number): boolean =>
  latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

type AddressLegCoordinates =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; reason: "missing" | "out_of_range" };

/** Coordinates of an address leg; null when the leg is a store pickup/return. */
const getAddressLegCoordinates = (
  leg: CreateReservationDeliveryLegInput | undefined,
): AddressLegCoordinates | null => {
  if (leg?.method !== "address") return null;
  if (!leg.latitude || !leg.longitude) return { ok: false, reason: "missing" };
  if (!isCoordinateInRange(leg.latitude, leg.longitude)) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, latitude: leg.latitude, longitude: leg.longitude };
};

const toErrorParams = (
  params: Record<string, unknown> | undefined,
): ReservationErrorParams | undefined => {
  if (!params) return undefined;
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * Pickup/return legs: store locations are snapshotted, address legs are
 * validated (coordinates, radius) and priced from the routed distance. The
 * fee is server-computed and free above the store threshold.
 */
export const resolveDelivery = async ({
  store,
  settings,
  delivery,
  subtotal,
}: {
  store: DeliveryStore;
  settings: DeliverySettings | undefined;
  delivery:
    | { outbound: CreateReservationDeliveryLegInput; return: CreateReservationDeliveryLegInput }
    | undefined;
  subtotal: number;
}): Promise<{ ok: true; delivery: ResolvedDelivery } | ReservationFailure> => {
  const deliveryMode = settings?.mode || "optional";
  const isDeliveryForced = deliveryMode === "required" || deliveryMode === "included";
  const isDeliveryIncluded = deliveryMode === "included";
  const isMultiLocationEnabled = Boolean(settings?.multiLocationEnabled);

  const outboundLeg = delivery?.outbound;
  const returnLeg = delivery?.return;
  const hasOutboundDelivery = outboundLeg?.method === "address";
  const hasReturnDelivery = returnLeg?.method === "address";
  const hasAnyDelivery = hasOutboundDelivery || hasReturnDelivery;
  const hasOutboundStore = !outboundLeg || outboundLeg.method === "store";
  const hasReturnStore = !returnLeg || returnLeg.method === "store";

  // Both store legs are looked up at once; a failing outbound leg is reported
  // before a failing return leg, whichever settles first.
  const [pickupResult, returnResult] = await Promise.allSettled([
    hasOutboundStore
      ? resolveReservationLocationSnapshot({
          store,
          locationId: isMultiLocationEnabled ? (outboundLeg?.locationId ?? null) : null,
        })
      : Promise.resolve(null),
    hasReturnStore
      ? resolveReservationLocationSnapshot({
          store,
          locationId: isMultiLocationEnabled ? (returnLeg?.locationId ?? null) : null,
        })
      : Promise.resolve(null),
  ]);
  if (pickupResult.status === "rejected") {
    return failReservation(getErrorKey(pickupResult.reason, "errors.locationInvalid"));
  }
  if (returnResult.status === "rejected") {
    return failReservation(getErrorKey(returnResult.reason, "errors.locationInvalid"));
  }
  const pickupLocation = pickupResult.value;
  const returnLocation = returnResult.value;

  if (isDeliveryForced && settings?.enabled && !hasOutboundDelivery) {
    return failReservation("errors.deliveryRequired");
  }

  let fee = 0;
  let outboundDistanceKm: number | null = null;
  let returnDistanceKm: number | null = null;

  if (hasAnyDelivery) {
    if (!settings?.enabled) {
      return failReservation("errors.deliveryNotEnabled");
    }
    if (!store.latitude || !store.longitude) {
      return failReservation("errors.storeCoordinatesNotConfigured");
    }

    const storeLatitude = parseFloat(store.latitude);
    const storeLongitude = parseFloat(store.longitude);
    if (
      !Number.isFinite(storeLatitude) ||
      !Number.isFinite(storeLongitude) ||
      !isCoordinateInRange(storeLatitude, storeLongitude)
    ) {
      return failReservation("errors.storeCoordinatesInvalid");
    }

    const outboundAddress = getAddressLegCoordinates(outboundLeg);
    if (outboundAddress && !outboundAddress.ok) {
      return failReservation(
        outboundAddress.reason === "missing"
          ? "errors.deliveryAddressRequired"
          : "errors.deliveryAddressInvalid",
      );
    }
    const returnAddress = getAddressLegCoordinates(returnLeg);
    if (returnAddress && !returnAddress.ok) {
      return failReservation(
        returnAddress.reason === "missing"
          ? "errors.returnAddressRequired"
          : "errors.returnAddressInvalid",
      );
    }

    // Legs are routed one after the other: an outbound address beyond the
    // radius is reported before the return leg costs a routing call.
    if (outboundAddress) {
      const outbound = await getRouteDistance({
        originLatitude: storeLatitude,
        originLongitude: storeLongitude,
        destinationLatitude: outboundAddress.latitude,
        destinationLongitude: outboundAddress.longitude,
      });
      outboundDistanceKm = outbound.distanceKm;
      const validation = validateDelivery(outboundDistanceKm, settings);
      if (!validation.valid) {
        return failReservation(
          validation.errorKey || "errors.deliveryTooFar",
          toErrorParams(validation.errorParams),
        );
      }
    }

    if (returnAddress) {
      const inbound = await getRouteDistance({
        originLatitude: storeLatitude,
        originLongitude: storeLongitude,
        destinationLatitude: returnAddress.latitude,
        destinationLongitude: returnAddress.longitude,
      });
      returnDistanceKm = inbound.distanceKm;
      const validation = validateDelivery(returnDistanceKm, settings);
      if (!validation.valid) {
        return failReservation("errors.returnAddressTooFar", toErrorParams(validation.errorParams));
      }
    }

    if (!isDeliveryIncluded) {
      fee = calculateTotalDeliveryFee(
        outboundDistanceKm,
        returnDistanceKm,
        settings,
        subtotal,
      ).totalFee;
    }
  }

  return {
    ok: true,
    delivery: {
      settings,
      outboundLeg,
      returnLeg,
      hasOutboundDelivery,
      hasReturnDelivery,
      hasAnyDelivery,
      fee,
      outboundDistanceKm,
      returnDistanceKm,
      pickupLocation,
      returnLocation,
    },
  };
};

/**
 * Optional delivery may require a minimum order; checked on the subtotal net
 * of the promo discount, after the promo has been evaluated.
 */
export const validateDeliveryMinimumOrder = (
  delivery: ResolvedDelivery,
  eligibleSubtotal: number,
): { ok: true } | ReservationFailure => {
  if (
    delivery.hasAnyDelivery &&
    delivery.settings &&
    !isDeliveryOrderAmountEligible(eligibleSubtotal, delivery.settings)
  ) {
    return failReservation("errors.deliveryMinimumOrderAmountNotMet", {
      amount: (delivery.settings.minimumOrderAmountForDelivery ?? 0).toFixed(2),
    });
  }
  return { ok: true };
};

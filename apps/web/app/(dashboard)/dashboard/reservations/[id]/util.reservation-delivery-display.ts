import type { ReservationLocationSnapshot } from "@louez/types";

export type ReservationDeliveryDisplayMode = "hidden" | "compact" | "full";

interface ReservationDeliveryFields {
  outboundMethod?: string | null;
  returnMethod?: string | null;
  deliveryOption?: string | null;
  deliveryAddress?: string | null;
  returnAddress?: string | null;
  deliveryFee?: string | null;
  pickupLocationSnapshot?: ReservationLocationSnapshot | null;
  returnLocationSnapshot?: ReservationLocationSnapshot | null;
}

export function getReservationDeliveryDisplayMode({
  reservation,
  showStoreLocations,
}: {
  reservation: ReservationDeliveryFields;
  showStoreLocations: boolean;
}): ReservationDeliveryDisplayMode {
  const hasAddressLeg =
    reservation.outboundMethod === "address" ||
    reservation.returnMethod === "address" ||
    reservation.deliveryOption === "delivery" ||
    (!reservation.outboundMethod && Boolean(reservation.deliveryAddress)) ||
    (!reservation.returnMethod && Boolean(reservation.returnAddress));
  const hasDeliveryFee = Boolean(
    reservation.deliveryFee && parseFloat(reservation.deliveryFee) > 0,
  );

  if (hasAddressLeg || hasDeliveryFee) {
    return "full";
  }

  const hasLocationSnapshot = Boolean(
    reservation.pickupLocationSnapshot || reservation.returnLocationSnapshot,
  );

  return hasLocationSnapshot && showStoreLocations ? "compact" : "hidden";
}

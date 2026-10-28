import { type ReservationGate, db, readReservationGate } from "@louez/db";
import type { ReservationGateReason } from "@louez/db";

import { log } from "@/lib/evlog";

// The card gate (louez-billing docs/api, README §8.4) on the app's side. The gate
// itself is in @louez/db (reservation-gate.ts): changeReservationStatus and
// insertReservation throw StoreNotAcceptingReservationsError, and each surface turns it
// into STORE_NOT_ACCEPTING_RESERVATIONS_ERROR. This logs each refusal once.

/** Where a refused reservation came from, for the log line: a booking source or an actor. */
export type ReservationGateSurface =
  | "online"
  | "phone"
  | "marketplace"
  | "dashboard"
  | "quote_acceptance"
  | "ai_chat"
  | "mcp";

export function logReservationGateRefusal(
  refusal: { readonly storeId: string; readonly reason: ReservationGateReason },
  surface: ReservationGateSurface,
): void {
  log.info(
    "billing",
    `card gate: store ${refusal.storeId} refused a new reservation from ${surface} (${refusal.reason})`,
  );
}

/**
 * The gate now, for a step that opens a booking which the helpers do not gate:
 * createReservation inserts it as pending, and its confirmation after payment is never
 * refused, so the checkout asks first.
 */
export async function checkReservationGate(
  storeId: string,
  surface: ReservationGateSurface,
): Promise<ReservationGate> {
  const gate = await readReservationGate(db, storeId);
  if (!gate.accepts) logReservationGateRefusal({ storeId, reason: gate.reason }, surface);
  return gate;
}

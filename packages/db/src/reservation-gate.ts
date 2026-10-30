import {
  type PolicyExecutor,
  type PolicyReservations,
  type StorePolicy,
  effectiveStorePolicy,
  readStorePolicyRecords,
  readStoresPolicyRecords,
} from "./billing-policy";
import { isBillingSyncEnabled } from "./billing-queue";

// The card gate (louez-billing docs/api, README §8.4 and §8.5; design §4.7). When the
// store's effective policy says `reservations.allowed: false`, Louez refuses every step
// that would put a new reservation into the billable set. changeReservationStatus and
// insertReservation call it themselves; createReservation, which inserts a pending
// booking, asks before it writes.
//
// Only in service mode (LOUEZ_BILLING=cloud with BILLING_SERVICE_URL, README §12). With
// billing off, a self-hosted instance, or in cloud mode without the service, the gate
// is always open and never reads the policy table.

/** Why a store is not taking reservations. Louez never shows it to renters. */
export type ReservationGateReason = Extract<PolicyReservations, { allowed: false }>["reason"];

export type ReservationGate =
  | { readonly accepts: true }
  | { readonly accepts: false; readonly reason: ReservationGateReason };

const OPEN: ReservationGate = { accepts: true };

/** The booking API's error code for a closed gate (README §8.4). */
export const STORE_NOT_ACCEPTING_RESERVATIONS = "store_not_accepting_reservations";

/**
 * Thrown by changeReservationStatus and insertReservation when the gate is closed. It
 * rolls back the caller's transaction; each surface turns it into its own answer.
 */
export class StoreNotAcceptingReservationsError extends Error {
  readonly code = STORE_NOT_ACCEPTING_RESERVATIONS;
  readonly storeId: string;
  readonly reason: ReservationGateReason;

  constructor(storeId: string, reason: ReservationGateReason) {
    super(`Store ${storeId} is not accepting new reservations (${reason})`);
    this.name = "StoreNotAcceptingReservationsError";
    this.storeId = storeId;
    this.reason = reason;
  }
}

export function isStoreNotAcceptingReservationsError(
  error: unknown,
): error is StoreNotAcceptingReservationsError {
  return error instanceof StoreNotAcceptingReservationsError;
}

/** The gate of a resolved policy: closed when it refuses. */
function gateOf(policy: StorePolicy): ReservationGate {
  if (policy.reservations.allowed) return OPEN;
  return { accepts: false, reason: policy.reservations.reason };
}

/** The gate of a store at `at` (the card gate uses now, README §8.3). */
export async function readReservationGate(
  executor: PolicyExecutor,
  storeId: string,
  at: Date = new Date(),
): Promise<ReservationGate> {
  if (!isBillingSyncEnabled()) return OPEN;
  return gateOf(effectiveStorePolicy(await readStorePolicyRecords(executor, storeId), at));
}

/** Throws StoreNotAcceptingReservationsError when the store's gate is closed at `at`. */
export async function assertStoreCanTakeReservations(
  executor: PolicyExecutor,
  storeId: string,
  at: Date = new Date(),
): Promise<void> {
  const gate = await readReservationGate(executor, storeId, at);
  if (!gate.accepts) throw new StoreNotAcceptingReservationsError(storeId, gate.reason);
}

/**
 * The stores among `storeIds` whose gate is closed at `at`, for the catalog feed's
 * `bookable`. Empty outside service mode, without a read.
 */
export async function readStoresNotAcceptingReservations(
  executor: PolicyExecutor,
  storeIds: readonly string[],
  at: Date = new Date(),
): Promise<ReadonlySet<string>> {
  if (!isBillingSyncEnabled() || storeIds.length === 0) return new Set();
  const closed = new Set<string>();
  for (const records of await readStoresPolicyRecords(executor, storeIds)) {
    if (!gateOf(effectiveStorePolicy(records, at)).accepts) closed.add(records.storeId);
  }
  return closed;
}

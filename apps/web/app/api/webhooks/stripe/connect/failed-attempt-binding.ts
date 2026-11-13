import { matchesDeploymentMode } from "./matches-deployment-mode";

/** Nanoid ids are 21 characters: anything else in Stripe's metadata is not Louez's. */
const isReservationId = (value: string | undefined): value is string =>
  typeof value === "string" && value.length === 21;

export type FailedAttemptRefusal =
  | "livemode_mismatch"
  | "connected_account_missing"
  | "invalid_reservation_id"
  | "reservation_not_found"
  | "connected_account_mismatch"
  | "reservation_mismatch";

/** A reservation as the binding reads it: its id and its store's connected account. */
export type BoundReservation = {
  readonly id: string;
  readonly store: { readonly stripeAccountId: string | null };
};

export type FailedAttemptBinding<R extends BoundReservation> =
  | { readonly ok: true; readonly reservation: R }
  | { readonly ok: false; readonly issue: FailedAttemptRefusal };

/**
 * The reservation a failed attempt of a rental payment is read on: the one of the
 * payment rows that record its PaymentIntent when there are, else the one the event
 * names.
 */
export const failedAttemptReservationId = (input: {
  readonly recordedReservationIds: readonly string[];
  readonly namedReservationId: string | undefined;
}): string | undefined => input.recordedReservationIds[0] ?? input.namedReservationId;

/**
 * Binds `payment_intent.payment_failed` of a rental payment to its reservation, in the
 * store of the account that sent it. The checks run in this order, the first that
 * fails refusing the event:
 *
 * - the event's mode is the deployment's (`livemode_mismatch`);
 * - the event names the account that sent it (`connected_account_missing`);
 * - with no payment row that records the PaymentIntent, the reservation the event
 *   names has Louez's id shape (`invalid_reservation_id`);
 * - the reservation read exists (`reservation_not_found`);
 * - its store's connected account is the one that sent the event
 *   (`connected_account_mismatch`);
 * - the rows that record the PaymentIntent are all of that reservation, and the
 *   reservation the event names, when it names one, is that one too
 *   (`reservation_mismatch`).
 *
 * The first two hold for a deposit hold's failed attempt as well: the route checks
 * them before it sends that one to the deposit events.
 */
export function failedAttemptBinding<R extends BoundReservation>(input: {
  readonly livemode: boolean;
  readonly secretKey: string | undefined;
  readonly accountId: string | undefined;
  readonly namedReservationId: string | undefined;
  /** The reservations of the payment rows that record the PaymentIntent. */
  readonly recordedReservationIds: readonly string[];
  /** The reservation `failedAttemptReservationId` gives, as read; null when there is none. */
  readonly reservation: R | null;
}): FailedAttemptBinding<R> {
  const refuse = (issue: FailedAttemptRefusal) => ({ ok: false, issue }) as const;
  const { accountId, namedReservationId, recordedReservationIds, reservation } = input;

  if (!matchesDeploymentMode(input)) return refuse("livemode_mismatch");
  if (!accountId) return refuse("connected_account_missing");
  if (recordedReservationIds.length === 0 && !isReservationId(namedReservationId)) {
    return refuse("invalid_reservation_id");
  }
  if (!reservation) return refuse("reservation_not_found");
  if (reservation.store.stripeAccountId !== accountId) return refuse("connected_account_mismatch");
  if (
    recordedReservationIds.some((id) => id !== reservation.id) ||
    (namedReservationId !== undefined && namedReservationId !== reservation.id)
  ) {
    return refuse("reservation_mismatch");
  }
  return { ok: true, reservation };
}

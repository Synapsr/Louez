/**
 * Customer-facing reading of the eight reservation statuses. Four states
 * matter to a customer (pending, confirmed, ongoing, completed); a quote is
 * a pending state with an action; cancelled / rejected / declined are closed
 * and shown greyed.
 */

export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "rejected",
  "quote",
  "declined",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const isReservationStatus = (value: string): value is ReservationStatus =>
  RESERVATION_STATUSES.some((status) => status === value);

/** Unknown values (future statuses) read as pending rather than crashing. */
export const toReservationStatus = (value: string): ReservationStatus =>
  isReservationStatus(value) ? value : "pending";

export type ReservationStatusBadgeVariant =
  | "pending"
  | "success"
  | "progress"
  | "tertiary"
  | "failed"
  | "submitted"
  | "expired";

export const RESERVATION_STATUS_BADGE_VARIANT: Record<
  ReservationStatus,
  ReservationStatusBadgeVariant
> = {
  pending: "pending",
  confirmed: "success",
  ongoing: "progress",
  completed: "tertiary",
  cancelled: "failed",
  rejected: "failed",
  quote: "submitted",
  declined: "expired",
};

/** Soft circle + text, on the `reservation-*` tokens. */
export const RESERVATION_STATUS_TONE_CLASS: Record<ReservationStatus, string> = {
  pending: "bg-reservation-pending-soft text-reservation-pending-text",
  confirmed: "bg-reservation-confirmed-soft text-reservation-confirmed-text",
  ongoing: "bg-reservation-ongoing-soft text-reservation-ongoing-text",
  completed: "bg-reservation-completed-soft text-reservation-completed-text",
  cancelled: "bg-reservation-cancelled-soft text-reservation-cancelled-text",
  rejected: "bg-reservation-rejected-soft text-reservation-rejected-text",
  quote: "bg-reservation-quote-soft text-reservation-quote-text",
  declined: "bg-reservation-declined-soft text-reservation-declined-text",
};

const CLOSED_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  "cancelled",
  "rejected",
  "declined",
]);
const CURRENT_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  "pending",
  "quote",
  "confirmed",
  "ongoing",
]);

export const isClosedReservationStatus = (status: ReservationStatus): boolean =>
  CLOSED_STATUSES.has(status);

/** Still to come or under way; the rest is past (completed or closed). */
export const isCurrentReservationStatus = (status: ReservationStatus): boolean =>
  CURRENT_STATUSES.has(status);

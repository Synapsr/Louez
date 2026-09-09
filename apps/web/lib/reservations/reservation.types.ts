import type { MissingRequiredAccessory } from "@louez/api/services";
import type { CreateReservationInput } from "@louez/validations";

export type ReservationSource = "online" | "phone" | "marketplace";

export type ReservationErrorParams = Record<string, string | number>;

export type ReservationFailureDetails = {
  code: "required_accessories_missing";
  missingAccessories: MissingRequiredAccessory[];
};

/** Every non-success outcome of the reservation pipeline (translation key + params). */
export type ReservationFailure = {
  ok: false;
  error: string;
  params?: ReservationErrorParams;
  details?: ReservationFailureDetails;
};

export type CreateReservationSuccess = {
  ok: true;
  reservationId: string;
  reservationNumber: string;
  customerId: string;
  customerEmail: string;
  /** Stripe Checkout URL when the store charges online, otherwise null. */
  paymentUrl: string | null;
  /**
   * Token URL to /r/{id} for a web customer whose reservation is a request
   * (no Stripe step); null in payment mode and for trusted callers.
   */
  instantAccessUrl: string | null;
  /** A marketplace replay of an already-written reservation. */
  idempotentReplay: boolean;
};

export type CreateReservationResult = CreateReservationSuccess | ReservationFailure;

export type ReservationQuote = {
  subtotal: number;
  discount: number;
  deposit: number;
  deliveryFee: number;
  total: number;
  currency: string;
};

export type QuoteReservationResult = { ok: true; quote: ReservationQuote } | ReservationFailure;

/**
 * Internal request: the validated public payload plus the fields only trusted
 * server callers may set. The public action always passes `source: "online"`.
 */
export type CreateReservationRequest = CreateReservationInput & {
  source: ReservationSource;
  /** Stable id supplied by the idempotent marketplace facade. */
  reservationId?: string;
  /** Server-only capability required for marketplace reservations. */
  marketplaceSecret?: string;
};

/** A quote prices the same cart without a customer, amounts or notes. */
export type QuoteReservationRequest = Omit<
  CreateReservationRequest,
  | "customer"
  | "customerNotes"
  | "subtotalAmount"
  | "depositAmount"
  | "totalAmount"
  | "advisorConversationId"
  | "reservationId"
  | "marketplaceSecret"
> & {
  customer?: CreateReservationInput["customer"];
};

export const failReservation = (
  error: string,
  params?: ReservationErrorParams,
  details?: ReservationFailureDetails,
): ReservationFailure => ({
  ok: false,
  error,
  ...(params ? { params } : {}),
  ...(details ? { details } : {}),
});

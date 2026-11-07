/** Customer actions: respond to a quote, pay, sign or download the contract. */

export interface ReservationActionsInput {
  status: string;
  isRentalPaid: boolean;
  isSigned: boolean;
  stripeAccountId: string | null | undefined;
  stripeChargesEnabled: boolean | null | undefined;
}

export type ReservationRequiredAction = "quote" | "payment";

export interface ReservationActions {
  /** The one thing to do next, in priority order: quote, then payment. */
  required: ReservationRequiredAction | null;
  canCancelRequest: boolean;
  canAcceptQuote: boolean;
  canPay: boolean;
  canSign: boolean;
  canDownloadContract: boolean;
}

const CONTRACT_STATUSES: ReadonlySet<string> = new Set(["confirmed", "ongoing", "completed"]);
const PAYABLE_STATUSES: ReadonlySet<string> = new Set(["confirmed", "ongoing"]);
// A finished rental is no longer signed: its contract stays as it was.
const SIGNABLE_STATUSES: ReadonlySet<string> = new Set(["confirmed", "ongoing"]);

/** The customer can sign a contract the store confirmed, until the rental ends. */
export const canSignContract = (status: string, isSigned: boolean): boolean =>
  SIGNABLE_STATUSES.has(status) && !isSigned;

export const getReservationActions = ({
  status,
  isRentalPaid,
  isSigned,
  stripeAccountId,
  stripeChargesEnabled,
}: ReservationActionsInput): ReservationActions => {
  const canAcceptQuote = status === "quote";
  const stripeActive = Boolean(stripeAccountId) && stripeChargesEnabled === true;
  const canPay = PAYABLE_STATUSES.has(status) && !isRentalPaid && stripeActive;
  const canDownloadContract = CONTRACT_STATUSES.has(status);
  const canSign = canSignContract(status, isSigned);

  const required: ReservationRequiredAction | null = canAcceptQuote
    ? "quote"
    : canPay
      ? "payment"
      : null;

  return {
    required,
    canCancelRequest: status === "pending",
    canAcceptQuote,
    canPay,
    canSign,
    canDownloadContract,
  };
};

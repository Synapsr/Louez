/** Customer actions: respond to a quote, pay, or download the validated contract. */

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
  canAcceptQuote: boolean;
  canPay: boolean;
  canSign: boolean;
  canDownloadContract: boolean;
}

const CONTRACT_STATUSES: ReadonlySet<string> = new Set(["confirmed", "ongoing", "completed"]);
const PAYABLE_STATUSES: ReadonlySet<string> = new Set(["confirmed", "ongoing"]);

export const getReservationActions = ({
  status,
  isRentalPaid,
  stripeAccountId,
  stripeChargesEnabled,
}: ReservationActionsInput): ReservationActions => {
  const canAcceptQuote = status === "quote";
  const stripeActive = Boolean(stripeAccountId) && stripeChargesEnabled === true;
  const canPay = PAYABLE_STATUSES.has(status) && !isRentalPaid && stripeActive;
  const canDownloadContract = CONTRACT_STATUSES.has(status);
  const canSign = false;

  const required: ReservationRequiredAction | null = canAcceptQuote
    ? "quote"
    : canPay
      ? "payment"
      : null;

  return { required, canAcceptQuote, canPay, canSign, canDownloadContract };
};

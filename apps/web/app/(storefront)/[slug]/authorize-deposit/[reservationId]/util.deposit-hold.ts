/**
 * Pure check of a Stripe PaymentIntent read back from Stripe before a deposit
 * hold is recorded: the intent must be a live manual-capture authorisation of
 * this reservation, for exactly the deposit, with a usable payment method.
 */
export interface DepositHoldCandidate {
  status: string;
  amount: number;
  currency: string;
  paymentMethodId: string | null | undefined;
  metadataReservationId: string | null | undefined;
}

export interface ExpectedDepositHold {
  reservationId: string;
  amountCents: number;
  currency: string;
}

export type DepositHoldVerdict =
  | { ok: true; paymentMethodId: string }
  | {
      ok: false;
      reason: "wrong_reservation" | "not_capturable" | "amount_mismatch" | "no_payment_method";
    };

export const verifyDepositHold = (
  intent: DepositHoldCandidate,
  expected: ExpectedDepositHold,
): DepositHoldVerdict => {
  if (intent.metadataReservationId !== expected.reservationId) {
    return { ok: false, reason: "wrong_reservation" };
  }
  if (intent.status !== "requires_capture") {
    return { ok: false, reason: "not_capturable" };
  }
  if (
    intent.amount !== expected.amountCents ||
    intent.currency.toUpperCase() !== expected.currency.toUpperCase()
  ) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if (!intent.paymentMethodId) {
    return { ok: false, reason: "no_payment_method" };
  }
  return { ok: true, paymentMethodId: intent.paymentMethodId };
};

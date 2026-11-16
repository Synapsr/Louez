import type { StoreSettings } from "@louez/types";

import { recordedPaymentAmount } from "@louez/api/services/payment-amount";

import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { type PaymentLike, getRentalPaid } from "@/lib/reservations/util.payment-status";
import { getRentalRemaining } from "@/lib/reservations/util.rental-amount";

export type PaymentRequestTerms =
  | {
      readonly ok: true;
      readonly amount: number;
      readonly description: string;
      readonly currency: string;
    }
  | {
      readonly ok: false;
      readonly error:
        | "errors.invalidAmount"
        | "errors.amountTooPrecise"
        | "errors.currencyNotSupportedForPayments"
        | "errors.noAmountDue"
        | "errors.noDepositRequired";
    };

/**
 * A custom request's amount, judged as the recorded payments judge theirs
 * (`recordedPaymentAmount`): a plain decimal above zero with at most the
 * decimals of the reservation's currency, in a currency the money layer
 * carries; then at least 0.50, the smallest request. 19.999 in euros is
 * refused, never asked of the customer as 20.00.
 */
export function customRequestAmount(
  typed: string | undefined,
  currency: string,
):
  | { readonly ok: true; readonly amount: number }
  | { readonly ok: false; readonly error: Extract<PaymentRequestTerms, { ok: false }>["error"] } {
  const verdict = recordedPaymentAmount(typed ?? "", "rental", currency);
  if (!verdict.ok) {
    return {
      ok: false,
      error:
        verdict.refusal === "too_precise"
          ? "errors.amountTooPrecise"
          : verdict.refusal === "currency_unsupported"
            ? "errors.currencyNotSupportedForPayments"
            : "errors.invalidAmount",
    };
  }
  // Two decimals at most: the number is the text, exactly.
  const amount = Number(verdict.amount);
  if (amount < 0.5) return { ok: false, error: "errors.invalidAmount" };
  return { ok: true, amount };
}

/**
 * What the store asks its customer to pay on a reservation: the rental still due,
 * the deposit, or an amount of its choice. It is owed in the reservation's currency,
 * frozen when the reservation was made, whatever the store's is now.
 */
export function paymentRequestTerms(input: {
  readonly type: "rental" | "deposit" | "custom";
  /**
   * The amount of a `custom` request, as typed (`typedAmount`): judged as
   * text, in the reservation's currency, never rounded first.
   */
  readonly customAmount?: string;
  readonly reservation: {
    readonly currency: string | null;
    readonly depositAmount: string;
    readonly totalAmount: string;
    readonly payments: readonly PaymentLike[];
  };
  readonly storeSettings: Pick<StoreSettings, "currency"> | null;
}): PaymentRequestTerms {
  const { reservation } = input;
  const currency = reservationCurrency(reservation.currency, input.storeSettings);

  if (input.type === "custom") {
    const custom = customRequestAmount(input.customAmount, currency);
    if (!custom.ok) return custom;
    return { ok: true, amount: custom.amount, description: "Payment", currency };
  }

  if (input.type === "rental") {
    // What was received in the reservation's currency: a payment in another one does
    // not reduce what is owed (invariant M6).
    const amount = getRentalRemaining(reservation, getRentalPaid(reservation.payments, currency));
    // In hundredths, exact: 0.57 less 0.07 leaves fifty cents due, not a float below.
    if (Math.round(amount * 100) < 50) return { ok: false, error: "errors.noAmountDue" };
    return { ok: true, amount, description: "Rental", currency };
  }

  const amount = parseFloat(reservation.depositAmount || "0");
  if (amount < 0.5) return { ok: false, error: "errors.noDepositRequired" };
  return { ok: true, amount, description: "Deposit", currency };
}

/** What the server says it sent of a payment request, by channel; a channel not tried is absent. */
export interface PaymentRequestNotificationResults {
  readonly email?: boolean;
  readonly sms?: boolean;
}

/**
 * What a payment request's success screen says: of the channels the person
 * chose, each sent or not, and whether all, some or none went. A chosen
 * channel the server did not report (no phone for an SMS) did not go. The
 * request and its link exist in every state.
 */
export type PaymentRequestDelivery =
  | { readonly state: "sent"; readonly sent: "email" | "sms" | "both" }
  | {
      readonly state: "partly_sent";
      readonly sent: "email" | "sms";
      readonly failed: "email" | "sms";
    }
  | { readonly state: "not_sent"; readonly failed: "email" | "sms" | "both" };

export function paymentRequestDelivery(
  chosen: { readonly email: boolean; readonly sms: boolean },
  results: PaymentRequestNotificationResults | undefined,
): PaymentRequestDelivery {
  const emailSent = chosen.email && results?.email === true;
  const smsSent = chosen.sms && results?.sms === true;
  const emailFailed = chosen.email && !emailSent;
  const smsFailed = chosen.sms && !smsSent;
  const which = (email: boolean, sms: boolean) => (email && sms ? "both" : email ? "email" : "sms");
  if (!emailFailed && !smsFailed) return { state: "sent", sent: which(emailSent, smsSent) };
  if (!emailSent && !smsSent) return { state: "not_sent", failed: which(emailFailed, smsFailed) };
  return {
    state: "partly_sent",
    sent: emailSent ? "email" : "sms",
    failed: emailFailed ? "email" : "sms",
  };
}

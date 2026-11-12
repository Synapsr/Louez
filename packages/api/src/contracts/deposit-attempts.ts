import { z } from "zod";

import { apiError } from "../platform/errors";

/**
 * The store closes a deposit hold it asked for and Stripe has not confirmed (apps/web
 * lib/reservations/deposit-hold.ts, `resolveUnconfirmedAttempt`).
 */

export const resolveDepositAttemptInput = z.object({
  reservationId: z.string().min(1).max(21),
});
export type ResolveDepositAttemptInput = z.infer<typeof resolveDepositAttemptInput>;

/**
 * `closed`: Louez found nothing at Stripe, or a PaymentIntent that holds nothing, the
 * attempt is closed with nothing held, and a new hold may be asked for. Otherwise Louez
 * found the attempt's PaymentIntent at Stripe and recorded it, as: `authorized` (the reservation's hold), `superseded` (the
 * reservation holds another: it is released), `captured`, `released`, `failed` (it
 * holds nothing), `pending` (Stripe has not decided yet).
 */
export const DEPOSIT_ATTEMPT_OUTCOMES = [
  "closed",
  "authorized",
  "superseded",
  "captured",
  "released",
  "failed",
  "pending",
] as const;

export const resolveDepositAttemptOutput = z.object({
  reservationId: z.string(),
  outcome: z.enum(DEPOSIT_ATTEMPT_OUTCOMES),
  paymentIntentId: z.string().nullable(),
});
export type ResolveDepositAttemptOutput = z.infer<typeof resolveDepositAttemptOutput>;

export const depositAttemptErrors = {
  none: (reservationId: string) =>
    apiError("CONFLICT", "DEPOSIT_ATTEMPT_NONE", {
      message:
        "This reservation has no deposit hold waiting for Stripe's confirmation: there is nothing to resolve. Read the reservation again.",
      i18nKey: "errors.depositAttempt.none",
      details: { reservationId },
    }),
  /**
   * Not retryable as it is: the store cancels the authorization in Stripe first. Once
   * Stripe holds nothing on it, closing the request again closes it; a captured one
   * never holds nothing, and the request stays open.
   */
  needsStripe: (
    reservationId: string,
    found: {
      paymentIntentId: string;
      status: string;
      reason: string;
      unmatchedFacts: readonly string[];
    },
  ) =>
    apiError("CONFLICT", "DEPOSIT_ATTEMPT_NEEDS_STRIPE", {
      message:
        "Louez found an authorization at Stripe for this deposit hold request, but it does not match what was asked (its amount, card or reference changed): it was not recorded, and the request stays open. Cancel it from the Stripe dashboard, then close the request again. If you capture it in Stripe instead, Louez does not record that money and the request stays open: record the amount by hand as a deposit payment and contact support to close the request.",
      i18nKey: "errors.depositAttempt.needsStripe",
      details: {
        reservationId,
        paymentIntentId: found.paymentIntentId,
        status: found.status,
        reason: found.reason,
        unmatchedFacts: [...found.unmatchedFacts],
      },
    }),
  inProgress: (reservationId: string) =>
    apiError("CONFLICT", "DEPOSIT_ATTEMPT_IN_PROGRESS", {
      message:
        "A request is asking Stripe about this deposit hold right now. Try again in a minute.",
      i18nKey: "errors.stripe.authorizationInProgress",
      retryable: true,
      details: { reservationId },
    }),
};

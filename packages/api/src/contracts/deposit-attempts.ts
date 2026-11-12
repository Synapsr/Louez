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
 * `closed`: Louez found nothing at Stripe, the attempt is closed with nothing held, and
 * a new hold may be asked for. Otherwise Louez found the attempt's PaymentIntent at
 * Stripe and recorded it, as: `authorized` (the reservation's hold), `superseded` (the
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
  inProgress: (reservationId: string) =>
    apiError("CONFLICT", "DEPOSIT_ATTEMPT_IN_PROGRESS", {
      message:
        "A request is asking Stripe about this deposit hold right now. Try again in a minute.",
      i18nKey: "errors.stripe.authorizationInProgress",
      retryable: true,
      details: { reservationId },
    }),
};

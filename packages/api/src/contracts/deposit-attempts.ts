import { z } from "zod";

import { apiError } from "../platform/errors";

/**
 * The store's resolution of a deposit hold it asked for and Stripe has not confirmed
 * (apps/web lib/reservations/deposit-hold.ts, `resolveUnconfirmedAttempt`).
 */

/** A Stripe PaymentIntent id, as its dashboard shows it. */
const paymentIntentIdSchema = z
  .string()
  .trim()
  .max(255)
  .regex(/^pi_[A-Za-z0-9_]+$/, "A Stripe PaymentIntent id starts with pi_.");

export const resolveDepositAttemptInput = z.object({
  reservationId: z.string().min(1).max(21),
  resolution: z.discriminatedUnion("kind", [
    /** The store checked its Stripe dashboard and found no authorization for the hold. */
    z.object({ kind: z.literal("nothing_at_stripe") }),
    /** The store names the PaymentIntent its Stripe dashboard shows for the hold. */
    z.object({ kind: z.literal("payment_intent"), paymentIntentId: paymentIntentIdSchema }),
  ]),
});
export type ResolveDepositAttemptInput = z.infer<typeof resolveDepositAttemptInput>;

/**
 * `closed`: the attempt is closed with nothing held, and a new hold may be asked for.
 * Otherwise what the named PaymentIntent was recorded as: `authorized` (the
 * reservation's hold), `superseded` (the reservation holds another: it is released),
 * `captured`, `released`, `failed` (it holds nothing), `pending` (Stripe has not
 * decided yet).
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
  foundAtStripe: (reservationId: string, paymentIntentId: string, outcome: string) =>
    apiError("CONFLICT", "DEPOSIT_ATTEMPT_FOUND_AT_STRIPE", {
      message: `Not closed: Stripe has the PaymentIntent ${paymentIntentId} for this deposit hold. It was recorded as ${outcome} instead.`,
      i18nKey: "errors.depositAttempt.foundAtStripe",
      details: { reservationId, paymentIntentId, outcome },
    }),
  intentNotFound: (reservationId: string, paymentIntentId: string) =>
    apiError("NOT_FOUND", "PAYMENT_INTENT_NOT_FOUND", {
      message: `Stripe has no PaymentIntent ${paymentIntentId} on the account this deposit hold was asked on. Nothing was written.`,
      i18nKey: "errors.depositAttempt.intentNotFound",
      details: { reservationId, paymentIntentId },
    }),
  intentMismatch: (reservationId: string, paymentIntentId: string, mismatches: readonly string[]) =>
    apiError("CONFLICT", "PAYMENT_INTENT_MISMATCH", {
      message: `Not recorded: ${paymentIntentId} is not the deposit hold this reservation asked for (${mismatches.join(", ")} do not match; its metadata must name this reservation and its depositHoldAttemptId). Nothing was written: handle that authorization from Stripe.`,
      i18nKey: "errors.depositAttempt.intentMismatch",
      details: { reservationId, paymentIntentId, mismatches },
    }),
  stripeUnavailable: (reservationId: string) =>
    apiError("INTERNAL_SERVER_ERROR", "STRIPE_UNAVAILABLE", {
      message: "Stripe could not be read. Nothing was written. Try again in a few minutes.",
      i18nKey: "errors.depositAttempt.stripeUnavailable",
      retryable: true,
      details: { reservationId },
    }),
};

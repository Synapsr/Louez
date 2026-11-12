import { eq } from "drizzle-orm";

import { type Database, reservations } from "@louez/db";

import { log } from "@/lib/evlog";
import type { DepositHoldDeps } from "@/lib/reservations/deposit-hold";
import { DEPOSIT_HOLD_ATTEMPT_METADATA } from "@/lib/reservations/deposit-hold-stripe";
import { readHoldRows, settleDepositIntent } from "@/lib/reservations/deposit-hold-writes";
import {
  type HoldOutcome,
  holdsNameIntentOnAccount,
  intentStateOf,
} from "@/lib/reservations/util.deposit-hold-transition";

import {
  type FailedPaymentIntent,
  type PaymentFailureDeps,
  handlePaymentFailure,
} from "./payment-failure";

// The Connect webhook's deposit events. Stripe does not order events, and delivers
// some twice: an authorization may come after the cancellation of the same
// PaymentIntent, a capture before Louez recorded the authorization. So an event only
// says which PaymentIntent to look at, on which account. What is recorded is that
// PaymentIntent as Stripe has it now, through the writer every other path uses
// (`settleDepositIntent`, lib/reservations/deposit-hold-writes.ts), which decides whether the
// PaymentIntent is written on the reservation at all.

export type DepositEvent = {
  readonly type:
    | "payment_intent.amount_capturable_updated"
    | "payment_intent.canceled"
    | "payment_intent.succeeded"
    | "payment_intent.payment_failed";
  readonly stripeEventId: string;
  /** The connected account that sent the event. */
  readonly accountId: string | undefined;
  readonly paymentIntent: FailedPaymentIntent;
};

/** What the handler runs on; the webhook route gives the app's (route.ts). */
export type DepositEventDeps = DepositHoldDeps & {
  /** The invoice of a captured deposit. */
  readonly generateInvoice: (capturePaymentId: string) => Promise<unknown>;
  /** What a recorded failure sends; the webhook's own when absent. */
  readonly paymentFailure?: PaymentFailureDeps;
};

export type DepositEventOutcome =
  /** Not a deposit hold's PaymentIntent. */
  | "ignored"
  /**
   * No reservation of that id, the event's account has no say about it, or the
   * PaymentIntent Stripe has is not the one a hold row expects: nothing was written.
   */
  | "rejected"
  /** What the PaymentIntent was recorded as. */
  | HoldOutcome;

/** Nanoid ids are 21 characters: anything else in Stripe's metadata is not ours. */
const isReservationId = (value: string | undefined): value is string =>
  typeof value === "string" && value.length === 21;

const loadReservation = (database: Database, reservationId: string) =>
  database.query.reservations.findFirst({
    where: eq(reservations.id, reservationId),
    with: { store: true, customer: true },
  });

/**
 * Handles a deposit hold's `payment_intent.*` event. The event was signed by Stripe.
 * Its body is trusted for three ids only: the PaymentIntent, the connected account and
 * the reservation its metadata names. Everything written comes from the PaymentIntent
 * as Stripe answers it on that account.
 *
 * An event of the store's connected account is read. One of an account the store left
 * is read only when a hold row of the reservation names that account for this
 * PaymentIntent, or is a pending attempt sent to it that has no PaymentIntent yet:
 * whoever holds an old account cannot write a hold on a reservation by naming it. A
 * thrown error answers 500, and Stripe's retry runs the handler again: every write is
 * idempotent.
 */
export async function handleDepositEvent(
  event: DepositEvent,
  deps: DepositEventDeps,
): Promise<DepositEventOutcome> {
  const { paymentIntent } = event;
  if (paymentIntent.metadata?.type !== "deposit_hold") return "ignored";

  const reject = (issue: string, details: Record<string, unknown> = {}) => {
    log.error({
      stripeWebhook: { event: event.type, issue, paymentIntentId: paymentIntent.id, ...details },
    });
    return "rejected" as const;
  };

  const reservationId = paymentIntent.metadata.reservationId;
  if (!isReservationId(reservationId)) return reject("invalid_reservation_id", { reservationId });
  const reservation = await loadReservation(deps.database, reservationId);
  if (!reservation) return reject("reservation_not_found", { reservationId });

  const accountId = event.accountId ?? reservation.store.stripeAccountId;
  if (!accountId) return reject("missing_account", { reservationId });
  if (reservation.store.stripeAccountId !== accountId) {
    const named = holdsNameIntentOnAccount(await readHoldRows(deps.database, reservationId), {
      accountId,
      paymentIntentId: paymentIntent.id,
      attemptId: paymentIntent.metadata[DEPOSIT_HOLD_ATTEMPT_METADATA] ?? null,
    });
    if (!named) {
      return reject("connected_account_mismatch", {
        reservationId,
        expected: reservation.store.stripeAccountId,
        received: accountId,
      });
    }
  }

  const intent = await deps.stripe.readIntent(accountId, paymentIntent.id);
  const settled = await settleDepositIntent(deps.database, {
    reservationId,
    accountId,
    intent,
    actorUserId: null,
  });
  if (settled.status === "reservation_not_found") {
    return reject("reservation_not_found", { reservationId });
  }
  if (settled.status === "refused") {
    return reject("intent_refused", { reservationId, accountId, reason: settled.reason });
  }
  // The reservation holds another authorization: this one's release is owed, and the
  // outbox asks Stripe for it, now and again until Stripe answers.
  deps.dispatchEffects(settled.effectIds);
  if (settled.capturePaymentId) await deps.generateInvoice(settled.capturePaymentId);

  if (event.type === "payment_intent.payment_failed") {
    const state = intentStateOf(intent.status);
    if (state === "held" || state === "captured") {
      // The failure was one try of a PaymentIntent that went through since: nobody is
      // told of a failed deposit that Stripe holds.
      log.info({
        stripeWebhook: {
          event: event.type,
          issue: "stale_failure",
          reservationId,
          paymentIntentId: paymentIntent.id,
          status: intent.status,
        },
      });
    } else {
      await handlePaymentFailure(
        {
          reservation,
          stripeEventId: event.stripeEventId,
          // The amount and the currency Stripe answers, not the event's.
          paymentIntent: { ...paymentIntent, amount: intent.amountMinor, currency: intent.currency },
        },
        deps.paymentFailure,
      );
    }
  }

  log.info({
    stripeWebhook: {
      event: event.type,
      outcome: settled.outcome,
      reservationId,
      paymentIntentId: paymentIntent.id,
      status: intent.status,
    },
  });
  return settled.outcome;
}

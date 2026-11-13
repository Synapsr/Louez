import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";

import { db } from "@louez/db";
import { payments, reservationActivity, reservations } from "@louez/db";
import type { NotificationSettings, StoreSettings } from "@louez/types";

import { notifyPaymentFailed } from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { fromStripeCents } from "@/lib/stripe";

/** The fields of a failed PaymentIntent the webhook reads. */
export type FailedPaymentIntent = Pick<
  Stripe.PaymentIntent,
  "id" | "amount" | "currency" | "metadata" | "last_payment_error"
>;

/** Whose PaymentIntent failed: the route tells, from the rows that record it. */
export type PaymentFailureKind = "deposit_hold" | "rental";

export type PaymentFailureRecord =
  | {
      readonly recorded: true;
      readonly kind: PaymentFailureKind;
      readonly amount: number;
      /** Upper case. */
      readonly currency: string;
      readonly errorCode: string | null;
      readonly declineCode: string | null;
    }
  | {
      readonly recorded: false;
      /**
       * `duplicate_event`: Stripe delivered this event again. `completed_payment`:
       * the payment went through on a later attempt, and a row of the reservation
       * records it `completed` or `refunded`. `deposit_held`: the reservation's
       * deposit is authorized or captured by another PaymentIntent, so the failure of
       * this one is no news.
       */
      readonly reason: "duplicate_event" | "completed_payment" | "deposit_held";
    };

/**
 * Records a `payment_intent.payment_failed` event on its reservation: the line of a
 * failed deposit hold, or of a failed attempt of a rental payment. It writes that line
 * and nothing else: a failed attempt leaves its Checkout Session open for another try,
 * and the session's completion or expiry settles the payment. Each event is recorded
 * once, by its Stripe event id kept on the activity row, under a lock on the
 * reservation row: a redelivered event changes nothing, while each failed attempt of
 * one PaymentIntent is its own event and is recorded. A rental payment a row of the
 * reservation records `completed` or `refunded` under that lock, a completion that
 * committed while this one waited included, makes the event stale.
 */
export async function recordPaymentFailure(input: {
  readonly kind: PaymentFailureKind;
  readonly reservationId: string;
  readonly stripeEventId: string;
  readonly paymentIntent: FailedPaymentIntent;
}): Promise<PaymentFailureRecord> {
  const { kind, reservationId, stripeEventId, paymentIntent } = input;
  const currency = paymentIntent.currency.toUpperCase();
  const amount = fromStripeCents(paymentIntent.amount, currency);
  const errorMessage = paymentIntent.last_payment_error?.message || "Unknown error";
  const errorCode = paymentIntent.last_payment_error?.code || null;
  const declineCode = paymentIntent.last_payment_error?.decline_code || null;

  const recorded = await db.transaction(async (tx) => {
    // Two deliveries of one event queue here, so only one finds it unrecorded.
    const [reservation] = await tx
      .select({
        depositStatus: reservations.depositStatus,
        depositPaymentIntentId: reservations.depositPaymentIntentId,
      })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for("update");
    // A deposit another PaymentIntent holds, read under the lock its writer takes: a
    // failure of this one, however late it arrives, tells nobody anything true.
    if (
      kind === "deposit_hold" &&
      (reservation?.depositStatus === "authorized" || reservation?.depositStatus === "captured") &&
      reservation.depositPaymentIntentId !== null &&
      reservation.depositPaymentIntentId !== paymentIntent.id
    ) {
      return "deposit_held" as const;
    }
    // The rows of the reservation that record this PaymentIntent, read under the lock
    // the completion's claim takes first: a payment it recorded is read once committed.
    if (kind === "rental") {
      const [paid] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, reservationId),
            eq(payments.stripePaymentIntentId, paymentIntent.id),
            inArray(payments.status, ["completed", "refunded"]),
          ),
        )
        .limit(1)
        .for("share");
      if (paid) return "completed_payment" as const;
    }
    const [seen] = await tx
      .select({ id: reservationActivity.id })
      .from(reservationActivity)
      .where(
        and(
          eq(reservationActivity.reservationId, reservationId),
          inArray(reservationActivity.activityType, ["payment_failed", "deposit_failed"]),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.stripeEventId')) = ${stripeEventId}`,
        ),
      )
      .limit(1);
    if (seen) return "duplicate_event" as const;

    if (kind === "deposit_hold") {
      // The hold's row and the reservation's deposit are written by the deposit events,
      // from the PaymentIntent as Stripe has it (deposit-events.ts): this is the line
      // of the event, which tells the store why the try failed.
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        activityType: "deposit_failed",
        metadata: {
          paymentIntentId: paymentIntent.id,
          stripeEventId,
          amount,
          error: errorMessage,
          errorCode,
          declineCode,
        },
        createdAt: new Date(),
      });
      return "recorded" as const;
    }

    await tx.insert(reservationActivity).values({
      id: nanoid(),
      reservationId,
      activityType: "payment_failed",
      metadata: {
        paymentIntentId: paymentIntent.id,
        stripeEventId,
        amount,
        currency,
        method: "stripe",
        error: errorMessage,
        errorCode,
        declineCode,
      },
      createdAt: new Date(),
    });
    return "recorded" as const;
  });

  return recorded === "recorded"
    ? { recorded: true, kind, amount, currency, errorCode, declineCode }
    : { recorded: false, reason: recorded };
}

/** The reservation a failed payment belongs to, as the webhook loaded it. */
export interface FailedPaymentReservation {
  readonly id: string;
  readonly number: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly totalAmount: string;
  readonly currency: string | null;
  readonly store: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly email: string | null;
    readonly discordWebhookUrl: string | null;
    readonly ownerPhone: string | null;
    readonly notificationSettings: NotificationSettings | null;
    readonly settings: StoreSettings | null;
  };
  readonly customer: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly phone: string | null;
  } | null;
}

/** What a recorded failure sends. A test replaces it. */
export interface PaymentFailureDeps {
  readonly dispatchNotification: typeof dispatchNotification;
  readonly notifyPaymentFailed: typeof notifyPaymentFailed;
}

const defaultDeps: PaymentFailureDeps = { dispatchNotification, notifyPaymentFailed };

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A failed payment of a reservation the event was bound to: records its line and
 * tells the owner and the platform, once per Stripe event. A marketplace booking
 * stays `pending` and its attempt `checkout_pending` while its customer tries again
 * in the open session.
 */
export async function handlePaymentFailure(
  input: {
    readonly kind: PaymentFailureKind;
    readonly reservation: FailedPaymentReservation;
    readonly stripeEventId: string;
    readonly paymentIntent: FailedPaymentIntent;
  },
  deps: PaymentFailureDeps = defaultDeps,
): Promise<void> {
  const { kind, reservation, stripeEventId, paymentIntent } = input;
  const failure = await recordPaymentFailure({
    kind,
    reservationId: reservation.id,
    stripeEventId,
    paymentIntent,
  });

  if (!failure.recorded) {
    log.info({
      stripeWebhook: {
        event: "payment_failed",
        issue:
          failure.reason === "completed_payment"
            ? "stale_event_for_completed_payment"
            : failure.reason === "deposit_held"
              ? "stale_failure_deposit_held"
              : "duplicate_event",
        reservationId: reservation.id,
        paymentIntentId: paymentIntent.id,
      },
    });
    return;
  }

  log.info({
    stripeWebhook: {
      event: "payment_failed",
      kind: failure.kind,
      reservationId: reservation.id,
      paymentIntentId: paymentIntent.id,
      errorCode: failure.errorCode,
      declineCode: failure.declineCode,
    },
  });

  deps
    .dispatchNotification("payment_failed", {
      actor: "system",
      store: {
        id: reservation.store.id,
        name: reservation.store.name,
        email: reservation.store.email,
        discordWebhookUrl: reservation.store.discordWebhookUrl,
        ownerPhone: reservation.store.ownerPhone,
        notificationSettings: reservation.store.notificationSettings,
        settings: reservation.store.settings,
      },
      reservation: {
        id: reservation.id,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: Number(reservation.totalAmount),
        currency: reservation.currency,
      },
      customer: reservation.customer
        ? {
            firstName: reservation.customer.firstName,
            lastName: reservation.customer.lastName,
            email: reservation.customer.email,
            phone: reservation.customer.phone,
          }
        : undefined,
      payment: { amount: failure.amount, currency: failure.currency },
    })
    .catch((error: unknown) => {
      log.error({
        stripeWebhook: {
          event: "payment_failed",
          issue: "notification_dispatch_failed",
          reservationId: reservation.id,
          error: describeError(error),
        },
      });
    });

  deps
    .notifyPaymentFailed(
      { id: reservation.store.id, name: reservation.store.name, slug: reservation.store.slug },
      reservation.number,
    )
    .catch(() => {});
}

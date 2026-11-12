import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";

import { failMarketplaceBookingAttempt } from "@louez/api/services";
import { db, markReservationIds } from "@louez/db";
import { payments, reservationActivity, reservations } from "@louez/db";
import type { NotificationSettings, StoreSettings } from "@louez/types";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { notifyPaymentFailed } from "@/lib/discord/platform-notifications";
import { log } from "@/lib/evlog";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { fromStripeCents } from "@/lib/stripe";

/** The fields of a failed PaymentIntent the webhook reads. */
export type FailedPaymentIntent = Pick<
  Stripe.PaymentIntent,
  "id" | "amount" | "currency" | "metadata" | "last_payment_error"
>;

export type PaymentFailureRecord =
  | {
      readonly recorded: true;
      readonly kind: "deposit_hold" | "rental";
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
       * the payment went through on a later attempt.
       */
      readonly reason: "duplicate_event" | "completed_payment";
    };

/**
 * Records a `payment_intent.payment_failed` event on its reservation: a failed
 * deposit hold, or a failed rental payment and its payment row. Each event is
 * recorded once, by its Stripe event id kept on the activity row, under a lock on
 * the reservation row: a redelivered event changes nothing, while each failed
 * attempt of one PaymentIntent is its own event and is recorded.
 */
export async function recordPaymentFailure(input: {
  readonly reservationId: string;
  readonly stripeEventId: string;
  readonly paymentIntent: FailedPaymentIntent;
}): Promise<PaymentFailureRecord> {
  const { reservationId, stripeEventId, paymentIntent } = input;
  const currency = paymentIntent.currency.toUpperCase();
  const amount = fromStripeCents(paymentIntent.amount, currency);
  const errorMessage = paymentIntent.last_payment_error?.message || "Unknown error";
  const errorCode = paymentIntent.last_payment_error?.code || null;
  const declineCode = paymentIntent.last_payment_error?.decline_code || null;
  const kind = paymentIntent.metadata?.type === "deposit_hold" ? "deposit_hold" : "rental";

  // A failed event for a payment that later went through is stale.
  const existingPayment =
    kind === "rental"
      ? await db.query.payments.findFirst({
          where: eq(payments.stripePaymentIntentId, paymentIntent.id),
          columns: { id: true, reservationId: true, status: true },
        })
      : undefined;
  if (existingPayment?.status === "completed") {
    return { recorded: false, reason: "completed_payment" };
  }

  const recorded = await db.transaction(async (tx) => {
    // Two deliveries of one event queue here, so only one finds it unrecorded.
    await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for("update");
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
    if (seen) return false;

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
      return true;
    }

    if (existingPayment && existingPayment.status !== "failed") {
      await tx
        .update(payments)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(payments.id, existingPayment.id));
      await markReservationIds(tx, [existingPayment.reservationId]);
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
    return true;
  });

  return recorded
    ? { recorded: true, kind, amount, currency, errorCode, declineCode }
    : { recorded: false, reason: "duplicate_event" };
}

/** The reservation a failed payment belongs to, as the webhook loaded it. */
export interface FailedPaymentReservation {
  readonly id: string;
  readonly number: string;
  readonly source: string | null;
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
  readonly failMarketplaceBookingAttempt: (reservationId: string) => Promise<void>;
}

const defaultDeps: PaymentFailureDeps = {
  dispatchNotification,
  notifyPaymentFailed,
  failMarketplaceBookingAttempt: (reservationId) =>
    failMarketplaceBookingAttempt(reservationId, runReservationEffects),
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * A failed payment of a reservation whose connected account was checked: records
 * it, expires a marketplace attempt still waiting for its checkout, and tells the
 * owner and the platform, once per Stripe event.
 */
export async function handlePaymentFailure(
  input: {
    readonly reservation: FailedPaymentReservation;
    readonly stripeEventId: string;
    readonly paymentIntent: FailedPaymentIntent;
  },
  deps: PaymentFailureDeps = defaultDeps,
): Promise<void> {
  const { reservation, stripeEventId, paymentIntent } = input;
  const failure = await recordPaymentFailure({
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
            : "duplicate_event",
        reservationId: reservation.id,
        paymentIntentId: paymentIntent.id,
      },
    });
    // A redelivery is how a marketplace expiry that failed is tried again.
    if (failure.reason === "duplicate_event") await expireMarketplaceAttempt(input, deps);
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

  // After the alerts, so an expiry that throws does not stop them: the webhook then
  // answers 500 and Stripe's redelivery tries the expiry again.
  await expireMarketplaceAttempt(input, deps);
}

/**
 * Expires a marketplace attempt still waiting for its checkout. Idempotent, so a
 * redelivered event may run it again.
 */
async function expireMarketplaceAttempt(
  input: {
    readonly reservation: FailedPaymentReservation;
    readonly paymentIntent: FailedPaymentIntent;
  },
  deps: PaymentFailureDeps,
): Promise<void> {
  if (
    input.paymentIntent.metadata?.type !== "deposit_hold" &&
    input.reservation.source === "marketplace"
  ) {
    await deps.failMarketplaceBookingAttempt(input.reservation.id);
  }
}

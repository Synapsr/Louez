import { eq } from "drizzle-orm";

import { db, reservations } from "@louez/db";

import { log } from "@/lib/evlog";
import { dispatchNotification } from "@/lib/notifications/dispatcher";

/**
 * Tells the store owner a customer disputed a payment, on the channels the store
 * keeps on for `payment_disputed`. Logs a failure, never throws: the dispute is
 * already recorded.
 */
export async function notifyPaymentDisputed(input: {
  readonly reservationId: string;
  /** The disputed amount, in the currency's main unit. */
  readonly amount: number;
  /** The dispute's currency, upper case. */
  readonly currency: string;
}): Promise<void> {
  try {
    const reservation = await db.query.reservations.findFirst({
      where: eq(reservations.id, input.reservationId),
      columns: {
        id: true,
        number: true,
        startDate: true,
        endDate: true,
        totalAmount: true,
        currency: true,
      },
      with: {
        store: {
          columns: {
            id: true,
            name: true,
            email: true,
            discordWebhookUrl: true,
            ownerPhone: true,
            notificationSettings: true,
            settings: true,
          },
        },
        customer: {
          columns: { firstName: true, lastName: true, email: true, phone: true },
        },
      },
    });
    if (!reservation) return;

    await dispatchNotification("payment_disputed", {
      store: reservation.store,
      reservation: {
        id: reservation.id,
        number: reservation.number,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        totalAmount: Number(reservation.totalAmount),
        currency: reservation.currency,
      },
      customer: reservation.customer ?? undefined,
      payment: { amount: input.amount, currency: input.currency },
    });
  } catch (error) {
    log.error({
      stripeWebhook: {
        event: "charge.dispute.created",
        issue: "notification_dispatch_failed",
        reservationId: input.reservationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

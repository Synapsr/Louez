import "server-only";

import { and, eq } from "drizzle-orm";

import { db, emailLogs, payments, reservations } from "@louez/db";

/** What the checkout's paid page may say: nothing of the customer. */
export interface CheckoutPaidView {
  number: string;
  /**
   * `received` once Louez recorded the payment; `unverified` otherwise, when
   * the page asserts nothing about a payment having been made.
   */
  state: "received" | "unverified";
  /** Whether a stored fact says this reservation's confirmation e-mail went out. */
  confirmationEmailSent: boolean;
}

/**
 * The paid page's view of a reservation of `storeId`, shown only for the
 * Stripe Checkout session of one of its own payments: the pair the checkout's
 * return handed the page. Any other pair answers null, as an unknown
 * reservation does, so the page tells no one whether a reservation exists or
 * was paid. The confirmation e-mail is said sent only when its `sent` log row
 * exists: the completion does not wait for the send.
 */
export const getCheckoutPaidView = async ({
  storeId,
  reservationId,
  stripeCheckoutSessionId,
}: {
  storeId: string;
  reservationId: string;
  stripeCheckoutSessionId: string;
}): Promise<CheckoutPaidView | null> => {
  const rows = await db
    .select({ number: reservations.number, paymentStatus: payments.status })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.stripeCheckoutSessionId, stripeCheckoutSessionId),
        eq(reservations.storeId, storeId),
      ),
    );

  const [row] = rows;
  if (!row) return null;

  if (!rows.some((payment) => payment.paymentStatus === "completed")) {
    return { number: row.number, state: "unverified", confirmationEmailSent: false };
  }

  const [sent] = await db
    .select({ id: emailLogs.id })
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.storeId, storeId),
        eq(emailLogs.reservationId, reservationId),
        eq(emailLogs.templateType, "reservation_confirmation"),
        eq(emailLogs.status, "sent"),
      ),
    )
    .limit(1);

  return { number: row.number, state: "received", confirmationEmailSent: sent !== undefined };
};

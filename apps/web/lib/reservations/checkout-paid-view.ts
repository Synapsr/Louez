import "server-only";

import { and, eq } from "drizzle-orm";

import { db, payments, reservations, stores } from "@louez/db";
import { withCustomerNotificationDefaults } from "@louez/types";

/** What the checkout's paid page may say: nothing of the customer. */
export interface CheckoutPaidView {
  number: string;
  /** `confirming` while Louez has not recorded the payment Stripe took. */
  state: "received" | "confirming";
  /** Whether the customer has been, or will be, sent the confirmation by e-mail. */
  confirmationByEmail: boolean;
}

/** The statuses a reservation holds once its payment confirmed it. */
const CONFIRMED_STATUSES: ReadonlySet<string> = new Set(["confirmed", "ongoing", "completed"]);

/**
 * The paid page's view of a reservation of `storeId`, shown only for the
 * Stripe Checkout session of one of its own payments: the pair Stripe's
 * return carries. Any other pair answers null, as an unknown reservation
 * does, so the page tells no one whether a reservation exists or was paid.
 * The confirmation e-mail is said sent only when the completion sends it: a
 * reservation the payment confirmed, in a store that e-mails confirmations.
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
    .select({
      number: reservations.number,
      reservationStatus: reservations.status,
      paymentStatus: payments.status,
      notificationSettings: stores.customerNotificationSettings,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.stripeCheckoutSessionId, stripeCheckoutSessionId),
        eq(reservations.storeId, storeId),
      ),
    );

  const [row] = rows;
  if (!row) return null;

  const state = rows.some((payment) => payment.paymentStatus === "completed")
    ? "received"
    : rows.some((payment) => payment.paymentStatus === "pending")
      ? "confirming"
      : null;
  if (!state) return null;

  const confirmation = withCustomerNotificationDefaults(
    row.notificationSettings,
  ).customer_reservation_confirmed;
  const emailsConfirmations = confirmation.enabled && confirmation.email;
  const confirmationByEmail =
    emailsConfirmations &&
    (state === "confirming"
      ? row.reservationStatus === "pending"
      : CONFIRMED_STATUSES.has(row.reservationStatus));

  return { number: row.number, state, confirmationByEmail };
};

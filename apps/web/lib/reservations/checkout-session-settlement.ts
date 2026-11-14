import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";

import {
  db,
  markReservationIds,
  payments,
  reservationActivity,
  reservations,
  toWholeSeconds,
  type Transaction,
  unsettledCheckoutSession,
} from "@louez/db";

import { completeCheckoutPayment } from "@/lib/reservations/complete-checkout-payment";
import { fromStripeCents } from "@/lib/stripe";
import { getStripe } from "@/lib/stripe/client";

/**
 * What Louez records of a rental Checkout Session, and what it reads of one at
 * Stripe. A session is settled when Louez knows what became of it: its row was
 * paid, or it is marked (`payments.session_settled_at`) because Stripe said it can
 * no longer be paid (`unsettledCheckoutSession`, `@louez/db`). Used by the Connect
 * webhook's `checkout.session.expired`, the customer's resumed payment and the
 * scheduled pass over abandoned checkouts.
 */

/** The session's fields its `payment_expired` line records. */
export type ExpiredCheckoutSession = Pick<
  Stripe.Checkout.Session,
  "id" | "amount_total" | "currency"
>;

/**
 * Locks the reservation's row. Each write here takes the reservation's row, then
 * its payment, then its history; the account deletion takes a store's products,
 * then its reservations, then their rows: the two run one after the other. A
 * reservation gone by then is written nothing.
 */
export async function lockReservationRow(tx: Transaction, reservationId: string): Promise<boolean> {
  const [locked] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .for("update");
  return locked !== undefined;
}

/** The session's line in the reservation's history: its id, amount and currency. */
export function checkoutSessionExpiredLine(
  reservationId: string,
  session: ExpiredCheckoutSession,
): typeof reservationActivity.$inferInsert {
  const currency = session.currency?.toUpperCase() || "EUR";
  return {
    id: nanoid(),
    reservationId,
    activityType: "payment_expired",
    description: null,
    metadata: {
      checkoutSessionId: session.id,
      amount: fromStripeCents(session.amount_total || 0, currency),
      currency,
      method: "stripe",
    },
    // Whole seconds, as the status change stores its `cancelled` row.
    createdAt: toWholeSeconds(new Date()),
  };
}

const expiredLineSession = sql<
  string | null
>`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.checkoutSessionId'))`;

/** Whether a `payment_expired` line of the reservation names the session. */
export async function hasExpiredLine(
  executor: Pick<Transaction, "select">,
  reservationId: string,
  sessionId: string,
): Promise<boolean> {
  const [recorded] = await executor
    .select({ id: reservationActivity.id })
    .from(reservationActivity)
    .where(
      and(
        eq(reservationActivity.reservationId, reservationId),
        eq(reservationActivity.activityType, "payment_expired"),
        sql`${expiredLineSession} = ${sessionId}`,
      ),
    )
    .limit(1);
  return recorded !== undefined;
}

/**
 * Records that a session expired, under the reservation's lock. A `pending` row
 * moves to `cancelled` and is marked by one update conditional on `pending`, and
 * only when that update moved it, the `payment_expired` line is written in the
 * same transaction: the checkout's expiry, whose cancellation the caller asks
 * for. A row no longer `pending` (a session a resume replaced) is marked alone,
 * when unsettled: no line, nothing else. Returns whether this call recorded a
 * checkout's expiry: another delivery, even a concurrent one, records nothing.
 */
export async function recordCheckoutSessionExpiry({
  reservationId,
  paymentId,
  session,
}: {
  reservationId: string;
  paymentId: string;
  session: ExpiredCheckoutSession;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await lockReservationRow(tx, reservationId))) return false;
    const now = new Date();
    const [cancelled] = await tx
      .update(payments)
      .set({ status: "cancelled", sessionSettledAt: now, updatedAt: now })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")));
    if (cancelled.affectedRows === 0) {
      await tx
        .update(payments)
        .set({ sessionSettledAt: now })
        .where(and(eq(payments.id, paymentId), unsettledCheckoutSession));
      return false;
    }
    await markReservationIds(tx, [reservationId]);
    await tx.insert(reservationActivity).values(checkoutSessionExpiredLine(reservationId, session));
    return true;
  });
}

/** A session to read at Stripe, on the account it lives on. */
export interface CheckoutSessionAtStripe {
  sessionId: string;
  account: string;
}

/** Per-request options of a read, such as a short timeout and no retry. */
export type CheckoutSessionReadOptions = Pick<
  Stripe.RequestOptions,
  "timeout" | "maxNetworkRetries"
>;

export type CheckoutSessionState =
  | { state: "expired"; session: ExpiredCheckoutSession }
  | { state: "complete" }
  | { state: "unknown" };

/**
 * What became of a session, read at Stripe on its account. With `expire`, it is
 * expired first: Stripe expires only an `open` session, and an expire that
 * succeeds leaves a session that can no longer complete. Otherwise, or when the
 * expire fails, the session is read: `complete` or paid, `expired`, or neither
 * known (still `open`, or not read).
 */
export async function readCheckoutSessionState(
  { sessionId, account }: CheckoutSessionAtStripe,
  { expire, request = {} }: { expire: boolean; request?: CheckoutSessionReadOptions },
): Promise<CheckoutSessionState> {
  if (expire) {
    try {
      const session = await getStripe().checkout.sessions.expire(sessionId, {
        ...request,
        stripeAccount: account,
      });
      return { state: "expired", session };
    } catch {
      // Not open any more, or Stripe not reached: read it.
    }
  }
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      ...request,
      stripeAccount: account,
    });
    if (session.status === "complete" || session.payment_status === "paid") {
      return { state: "complete" };
    }
    return session.status === "expired" ? { state: "expired", session } : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

/** At most this many sessions of one reservation are read at Stripe at once. */
const SESSION_READS_AT_ONCE = 5;

/** `readCheckoutSessionState` for each session, a few at once, in their order. */
export async function readCheckoutSessionStates<Session extends CheckoutSessionAtStripe>(
  sessions: readonly Session[],
  options: { expire: boolean; request?: CheckoutSessionReadOptions },
): Promise<Array<Session & CheckoutSessionState>> {
  const states: Array<Session & CheckoutSessionState> = [];
  for (let start = 0; start < sessions.length; start += SESSION_READS_AT_ONCE) {
    const batch = sessions.slice(start, start + SESSION_READS_AT_ONCE);
    const read = await Promise.all(
      batch.map(async (session) => ({
        ...session,
        ...(await readCheckoutSessionState(session, options)),
      })),
    );
    states.push(...read);
  }
  return states;
}

/**
 * Records a session found paid at Stripe as the customer's return records it
 * (`completeCheckoutPayment`): the payment claimed once, whichever of the
 * return, the webhook or this call comes first, then the reservation confirmed.
 */
export function recordPaidCheckoutSession({
  storeId,
  reservationId,
  sessionId,
}: {
  storeId: string;
  reservationId: string;
  sessionId: string;
}) {
  return completeCheckoutPayment({
    source: "return",
    storeId,
    reservationId,
    stripeCheckoutSessionId: sessionId,
  });
}

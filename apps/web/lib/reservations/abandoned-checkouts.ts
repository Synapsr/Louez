import { type SQL, and, asc, eq, exists, gt, gte, isNotNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import {
  ONLINE_CHECKOUT_SOURCE,
  changeSystemReservationStatus,
} from "@louez/api/services/system-reservation-status";
import { db, payments, reservations, stores } from "@louez/db";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { log } from "@/lib/evlog";
import {
  checkoutSessionAccount,
  isSessionCreationRow,
} from "@/lib/reservations/checkout-session-account";
import {
  expiredSessionIds,
  readCheckoutSessionStates,
  recordCheckoutSessionExpiry,
  recordPaidCheckoutSession,
} from "@/lib/reservations/checkout-session-settlement";
import { CHECKOUT_SESSION_LIFETIME_SECONDS } from "@/lib/stripe";

/**
 * Past a session's lifetime, how long the pass waits before it looks at a
 * checkout: the expiry's or the completion's event usually comes first, and the
 * session's expiry, set by Louez's clock, is enforced by Stripe's.
 */
const LOOK_AFTER_LIFETIME_MS = 5 * 60 * 1000;
/**
 * How long after its newest session a checkout stays within the pass's reach. A
 * checkout older than that, whose sessions stayed unreadable, or that was left
 * before the pass existed, is not looked at.
 */
const ABANDONED_CHECKOUT_REACH_MS = 48 * 60 * 60 * 1000;
/** Most checkouts one run looks at, oldest first. */
export const ABANDONED_CHECKOUTS_PER_RUN = 20;

export type AbandonedCheckoutOutcome = "confirmed" | "cancelled" | "left" | "unreadable";

/**
 * The online checkouts no event will settle: a reservation from the storefront's
 * online checkout, still `pending`, with no rental payment `completed`, whose
 * newest rental session was created more than a session's lifetime and a margin
 * ago and less than 48 hours ago, oldest first. The age decides only when the
 * pass looks; Stripe says what became of each session.
 */
export async function findAbandonedCheckouts(now: Date) {
  const lookBefore = new Date(
    now.getTime() - CHECKOUT_SESSION_LIFETIME_SECONDS * 1000 - LOOK_AFTER_LIFETIME_MS,
  );
  const reachAfter = new Date(now.getTime() - ABANDONED_CHECKOUT_REACH_MS);
  const sessionRow = alias(payments, "session_row");
  const completedRow = alias(payments, "completed_row");
  const sessionRows = (since: SQL) =>
    db
      .select({ id: sessionRow.id })
      .from(sessionRow)
      .where(
        and(
          eq(sessionRow.reservationId, reservations.id),
          eq(sessionRow.type, "rental"),
          isNotNull(sessionRow.stripeCheckoutSessionId),
          since,
        ),
      );
  return db
    .select({ id: reservations.id, storeId: reservations.storeId })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "pending"),
        eq(reservations.source, ONLINE_CHECKOUT_SOURCE),
        notExists(
          db
            .select({ id: completedRow.id })
            .from(completedRow)
            .where(
              and(
                eq(completedRow.reservationId, reservations.id),
                eq(completedRow.type, "rental"),
                eq(completedRow.status, "completed"),
              ),
            ),
        ),
        exists(sessionRows(gt(sessionRow.createdAt, reachAfter))),
        notExists(sessionRows(gte(sessionRow.createdAt, lookBefore))),
      ),
    )
    .orderBy(
      asc(
        sql`(SELECT MAX(newest.created_at) FROM payments newest WHERE newest.reservation_id = ${reservations.id} AND newest.payment_type = 'rental' AND newest.stripe_checkout_session_id IS NOT NULL)`,
      ),
    )
    .limit(ABANDONED_CHECKOUTS_PER_RUN);
}

/**
 * One checkout. Every unsettled rental session (a `pending` row, or a `cancelled`
 * one no `payment_expired` line names) is read at Stripe, never expired: past
 * its lifetime a session cannot be open. One paid is recorded as the customer's
 * return records it, and the reservation is confirmed. When every one is
 * expired, each `pending` row is recorded as the `checkout.session.expired`
 * handler records it, then the checkout's cancellation is asked for, under the
 * reservation's lock: it leaves a reservation a resume has meanwhile given an
 * open payment. One unread, or still open, leaves the reservation to the next run.
 */
export async function settleAbandonedCheckout(checkout: {
  id: string;
  storeId: string;
}): Promise<AbandonedCheckoutOutcome> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, checkout.storeId),
    columns: { stripeAccountId: true },
  });
  const rows = await db
    .select({
      id: payments.id,
      status: payments.status,
      origin: payments.origin,
      sessionId: payments.stripeCheckoutSessionId,
      stripeAccountId: payments.stripeAccountId,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, checkout.id),
        eq(payments.type, "rental"),
        isNotNull(payments.stripeCheckoutSessionId),
      ),
    );
  const expired = await expiredSessionIds(db, checkout.id);
  const unsettled = [];
  for (const row of rows) {
    if (!row.sessionId) continue;
    const settled =
      row.status !== "pending" && !(row.status === "cancelled" && !expired.has(row.sessionId));
    if (settled) continue;
    // On the account its row records, the one it was created on; a row that
    // records none, on the store's.
    const account = checkoutSessionAccount({
      recordedAccountId: isSessionCreationRow(row) ? row.stripeAccountId : null,
      storeAccountId: store?.stripeAccountId ?? null,
    });
    if (!account) return "unreadable";
    unsettled.push({ paymentId: row.id, status: row.status, sessionId: row.sessionId, account });
  }
  const states = await readCheckoutSessionStates(unsettled, { expire: false });

  const paid = states.find(({ state }) => state === "complete");
  if (paid) {
    const completion = await recordPaidCheckoutSession({
      storeId: checkout.storeId,
      reservationId: checkout.id,
      sessionId: paid.sessionId,
    });
    return completion.status === "completed" ? "confirmed" : "unreadable";
  }
  if (states.some(({ state }) => state === "unknown")) return "unreadable";

  for (const row of states) {
    if (row.state === "expired" && row.status === "pending") {
      await recordCheckoutSessionExpiry({
        reservationId: checkout.id,
        paymentId: row.paymentId,
        session: row.session,
      });
    }
  }
  const [newest] = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (!newest) return "left";
  const cancelled = await changeSystemReservationStatus(
    {
      reason: "checkout_abandoned",
      reservationId: checkout.id,
      checkoutSessionId: String(newest.sessionId),
    },
    runReservationEffects,
  );
  return cancelled ? "cancelled" : "left";
}

/**
 * The cron's pass over abandoned checkouts. Each checkout is its own unit: one
 * that fails is logged and the others go on. It holds no transaction across a
 * Stripe call, and two runs at once write each record once: the conditional
 * updates and the reservation's lock make the second a no-op.
 */
export async function settleAbandonedCheckouts(now: Date = new Date()) {
  const counts: Record<AbandonedCheckoutOutcome | "failed", number> = {
    confirmed: 0,
    cancelled: 0,
    left: 0,
    unreadable: 0,
    failed: 0,
  };
  for (const checkout of await findAbandonedCheckouts(now)) {
    try {
      const outcome = await settleAbandonedCheckout(checkout);
      counts[outcome] += 1;
      if (outcome === "unreadable") {
        log.warn({
          abandonedCheckouts: { event: "sessions_unreadable", reservationId: checkout.id },
        });
      }
    } catch (error) {
      counts.failed += 1;
      log.error({
        abandonedCheckouts: {
          event: "checkout_failed",
          reservationId: checkout.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return counts;
}

import { type SQL, and, eq, gt, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import {
  ONLINE_CHECKOUT_SOURCE,
  changeSystemReservationStatus,
} from "@louez/api/services/system-reservation-status";
import {
  db,
  isUnsettledCheckoutSession,
  markCheckoutSessionSettled,
  payments,
  reservations,
  stores,
  unsettledCheckoutSession,
} from "@louez/db";

import { runReservationEffects } from "@/lib/billing/reservation-effects";
import { log } from "@/lib/evlog";
import {
  checkoutSessionAccount,
  isSessionCreationRow,
} from "@/lib/reservations/checkout-session-account";
import {
  type CheckoutSessionReadOptions,
  readCheckoutSessionStates,
  recordCheckoutSessionExpiry,
  recordPaidCheckoutSession,
} from "@/lib/reservations/checkout-session-settlement";
import { CHECKOUT_SESSION_LIFETIME_SECONDS } from "@/lib/stripe";

/**
 * Past a session's lifetime, how long the pass waits before it reads it: the
 * expiry's or the completion's event usually comes first, and the session's
 * expiry, set by Louez's clock, is enforced by Stripe's.
 */
const LOOK_AFTER_LIFETIME_MS = 5 * 60 * 1000;
/**
 * How long after it was written an unsettled session stays within the pass's
 * reach. One older than that, whose session stayed unreadable, or that was
 * written before the record existed, is not looked at.
 */
const ABANDONED_CHECKOUT_REACH_MS = 48 * 60 * 60 * 1000;
/** Most checkouts one run looks at, drawn at random from those in the window. */
export const ABANDONED_CHECKOUTS_PER_RUN = 20;
/**
 * How long a run keeps taking checkouts: past it, those left wait for the next
 * run, so a slow provider holds the cron's call for a bounded time.
 */
export const ABANDONED_CHECKOUTS_RUN_BUDGET_MS = 20_000;
/** Each read at Stripe: a short timeout, and no retry of the SDK's own. */
export const ABANDONED_CHECKOUT_READ: CheckoutSessionReadOptions = {
  timeout: 5_000,
  maxNetworkRetries: 0,
};
/** Most reservation ids a run's log line names. */
const LOGGED_IDS_PER_RUN = 5;
/**
 * The order a run draws its batch in: at random, so checkouts that stay
 * unreadable (a store whose Stripe account is gone) cannot hold every run while
 * others wait. With N checkouts in the window and a batch of B, one is left out
 * of a run with probability 1 - B/N, and out of k runs with (1 - B/N)^k.
 */
const RANDOM_ORDER = sql`RAND()`;

export type AbandonedCheckoutOutcome = "confirmed" | "cancelled" | "left" | "unreadable";

/**
 * The checkouts with an unsettled rental session old enough to be over: a
 * reservation from the storefront's online checkout, still `pending`, with no
 * rental payment `completed`, with a rental row whose session is unsettled
 * (`unsettledCheckoutSession`) and that was written more than a session's
 * lifetime and a margin ago and less than 48 hours ago; a batch in `order` (at
 * random). The query starts from `payments`, through
 * `payments_session_settled_created_idx` (the unmarked rows, by their age), reads
 * each row's reservation by its primary key, and its completed payments through
 * `payments_reservation_idx`.
 */
export function abandonedCheckoutsQuery(now: Date, order: SQL = RANDOM_ORDER) {
  const completed = alias(payments, "completed_payment");
  return db
    .select({ id: reservations.id, storeId: reservations.storeId })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        unsettledCheckoutSession,
        gt(payments.createdAt, new Date(now.getTime() - ABANDONED_CHECKOUT_REACH_MS)),
        lt(payments.createdAt, lookBefore(now)),
        eq(reservations.status, "pending"),
        eq(reservations.source, ONLINE_CHECKOUT_SOURCE),
        notExists(
          db
            .select({ id: completed.id })
            .from(completed)
            .where(
              and(
                eq(completed.reservationId, reservations.id),
                eq(completed.type, "rental"),
                eq(completed.status, "completed"),
              ),
            ),
        ),
      ),
    )
    .groupBy(reservations.id, reservations.storeId)
    .orderBy(order)
    .limit(ABANDONED_CHECKOUTS_PER_RUN);
}

/** The batch `abandonedCheckoutsQuery` draws. */
export async function findAbandonedCheckouts(now: Date, order: SQL = RANDOM_ORDER) {
  return abandonedCheckoutsQuery(now, order);
}

const lookBefore = (now: Date) =>
  new Date(now.getTime() - CHECKOUT_SESSION_LIFETIME_SECONDS * 1000 - LOOK_AFTER_LIFETIME_MS);

/**
 * One checkout. Each unsettled rental session old enough to be over is read at
 * Stripe, never expired: past its lifetime a session cannot be open. One read
 * `expired` is marked: a `pending` row through the `checkout.session.expired`
 * handler's own write (cancelled, marked, its line), a `cancelled` one alone. One
 * paid is recorded as the customer's return records it. One unread, or still
 * open, leaves the reservation to the next run. Then the checkout's cancellation
 * is asked for, under the reservation's lock: it cancels only a checkout with no
 * rental payment pending or completed and no unsettled session.
 */
export async function settleAbandonedCheckout(
  checkout: { id: string; storeId: string },
  { now = new Date(), request = ABANDONED_CHECKOUT_READ } = {},
): Promise<AbandonedCheckoutOutcome> {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, checkout.storeId),
    columns: { stripeAccountId: true },
  });
  const rows = await db
    .select({
      id: payments.id,
      type: payments.type,
      status: payments.status,
      origin: payments.origin,
      stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      stripeAccountId: payments.stripeAccountId,
      sessionSettledAt: payments.sessionSettledAt,
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
  const due = lookBefore(now);
  const sessions = [];
  for (const row of rows) {
    if (!isUnsettledCheckoutSession(row) || !row.stripeCheckoutSessionId) continue;
    // A younger session may still be open: the cancellation below leaves it.
    if (row.createdAt >= due) continue;
    // On the account its row records, the one it was created on; a row that
    // records none, on the store's.
    const account = checkoutSessionAccount({
      recordedAccountId: isSessionCreationRow(row) ? row.stripeAccountId : null,
      storeAccountId: store?.stripeAccountId ?? null,
    });
    if (!account) return "unreadable";
    sessions.push({
      paymentId: row.id,
      status: row.status,
      sessionId: row.stripeCheckoutSessionId,
      account,
    });
  }
  const states = await readCheckoutSessionStates(sessions, { expire: false, request });

  for (const session of states) {
    if (session.state !== "expired") continue;
    if (session.status === "pending") {
      await recordCheckoutSessionExpiry({
        reservationId: checkout.id,
        paymentId: session.paymentId,
        session: session.session,
      });
    } else {
      await markCheckoutSessionSettled(db, session.paymentId);
    }
  }
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

  const [newest] = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (!newest) return "left";
  const cancelled = await changeSystemReservationStatus(
    {
      reason: "checkout_abandoned",
      reservationId: checkout.id,
      checkoutSessionId: String(newest.stripeCheckoutSessionId),
    },
    runReservationEffects,
  );
  return cancelled ? "cancelled" : "left";
}

/**
 * The cron's pass over abandoned checkouts. Each checkout is its own unit: one
 * that fails is counted and the others go on. Once its time budget is spent it
 * takes no new checkout: those left wait for the next run. It holds no
 * transaction across a Stripe call, and two runs at once write each record once:
 * the conditional updates and the reservation's lock make the second a no-op. A
 * run that left checkouts unread, failed or waiting logs one line: its counts and
 * a few of their ids. `order`, `clock` and `request` are for tests.
 */
export async function settleAbandonedCheckouts({
  now = new Date(),
  order,
  clock = Date.now,
  request = ABANDONED_CHECKOUT_READ,
}: {
  now?: Date;
  order?: SQL;
  clock?: () => number;
  request?: CheckoutSessionReadOptions;
} = {}) {
  const deadline = clock() + ABANDONED_CHECKOUTS_RUN_BUDGET_MS;
  const counts: Record<AbandonedCheckoutOutcome | "failed" | "waiting", number> = {
    confirmed: 0,
    cancelled: 0,
    left: 0,
    unreadable: 0,
    failed: 0,
    waiting: 0,
  };
  const skipped: string[] = [];
  // The first failure's kind only: a provider's message may name an account.
  let firstError: string | undefined;
  for (const checkout of await findAbandonedCheckouts(now, order)) {
    if (clock() >= deadline) {
      counts.waiting += 1;
      skipped.push(checkout.id);
      continue;
    }
    try {
      const outcome = await settleAbandonedCheckout(checkout, { now, request });
      counts[outcome] += 1;
      if (outcome === "unreadable") skipped.push(checkout.id);
    } catch (error) {
      counts.failed += 1;
      skipped.push(checkout.id);
      firstError ??= error instanceof Error ? error.name : "unknown";
    }
  }
  if (skipped.length > 0) {
    log.warn({
      abandonedCheckouts: {
        event: "run_skipped",
        unreadable: counts.unreadable,
        failed: counts.failed,
        waiting: counts.waiting,
        reservationIds: skipped.slice(0, LOGGED_IDS_PER_RUN),
        ...(firstError && { firstError }),
      },
    });
  }
  return counts;
}

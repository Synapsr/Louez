import {
  type SQL,
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import {
  ONLINE_CHECKOUT_SOURCE,
  changeSystemReservationStatus,
} from "@louez/api/services/system-reservation-status";
import {
  checkoutSessionRowIn,
  db,
  isCheckoutSessionRow,
  isUnsettledCheckoutSession,
  markCheckoutSessionSettled,
  payments,
  reservations,
  stores,
  unsettledCheckoutSession,
  unsettledCheckoutSessionIn,
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
/** Most checkouts one run looks at, both questions together (`findAbandonedCheckouts`). */
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
 * The order a run draws each question's checkouts in: at random, so checkouts
 * that stay unreadable (a store whose Stripe account is gone) cannot hold every
 * run while others wait. With N checkouts of a question and B places for it in
 * the batch (half of it at least while the other question fills its half), one
 * is left out of a run with probability 1 - B/N, and out of k runs with
 * (1 - B/N)^k.
 */
const RANDOM_ORDER = sql`RAND()`;

export type AbandonedCheckoutOutcome = "confirmed" | "cancelled" | "left" | "unreadable";

/** Which of the pass's two questions a checkout is drawn for. */
export type AbandonedCheckoutBranch = "unsettled" | "settled";

export interface AbandonedCheckout {
  id: string;
  storeId: string;
  branch: AbandonedCheckoutBranch;
}

/**
 * The checkouts with an unsettled rental session old enough to be over: a
 * reservation from the storefront's online checkout, still `pending`, with no
 * rental payment `completed`, with a rental row of its checkout (`checkoutSessionRowIn`:
 * not a payment request's) whose session is unsettled
 * (`unsettledCheckoutSession`) and that was written more than a session's
 * lifetime and a margin ago and less than 48 hours ago; a batch in `order` (at
 * random). The query starts from `payments`, through
 * `payments_session_settled_created_idx` (the unmarked rows, by their age), reads
 * each row's reservation by its primary key, and its completed payments through
 * `payments_reservation_idx`. Each is read at Stripe.
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
        // A payment request's session never makes a reservation a checkout.
        checkoutSessionRowIn(payments),
        gt(payments.createdAt, reachAfter(now)),
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

/**
 * The checkouts whose sessions are all settled and that have no payment left: a
 * reservation from the storefront's online checkout, still `pending`, with a
 * session row of its checkout (not a payment request's) marked settled, with no
 * rental payment `pending` or `completed`, no unsettled session, and whose newest
 * mark (`session_settled_at` of its rental sessions) is more than a session's
 * lifetime and a margin and less than 48 hours old. The delay is on the mark: a
 * resume in flight marks the session it replaces and installs its successor a
 * moment later, and the delay keeps the pass away from it; the cancellation's
 * guard under the reservation's lock covers the rest. The query starts from
 * `payments`, through `payments_session_settled_created_idx` (a range of marks),
 * reads each row's reservation by its primary key, and its other payments through
 * `payments_reservation_idx`. None is read at Stripe.
 */
export function settledCheckoutsQuery(now: Date, order: SQL = RANDOM_ORDER) {
  const other = alias(payments, "other_payment");
  return db
    .select({ id: reservations.id, storeId: reservations.storeId })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(
      and(
        // A payment request's session never makes a reservation a checkout.
        checkoutSessionRowIn(payments),
        gt(payments.sessionSettledAt, reachAfter(now)),
        lt(payments.sessionSettledAt, lookBefore(now)),
        eq(reservations.status, "pending"),
        eq(reservations.source, ONLINE_CHECKOUT_SOURCE),
        // No payment left, no session that may still be paid, and no mark younger
        // than the delay: the newest mark decides.
        notExists(
          db
            .select({ id: other.id })
            .from(other)
            .where(
              and(
                eq(other.reservationId, reservations.id),
                or(
                  and(eq(other.type, "rental"), inArray(other.status, ["pending", "completed"])),
                  unsettledCheckoutSessionIn(other),
                  and(eq(other.type, "rental"), gte(other.sessionSettledAt, lookBefore(now))),
                ),
              ),
            ),
        ),
      ),
    )
    .groupBy(reservations.id, reservations.storeId)
    .orderBy(order)
    .limit(ABANDONED_CHECKOUTS_PER_RUN);
}

/**
 * One batch for both questions: each is drawn at random (`order`), at most a
 * batch each, and the two are taken in turn, one of each, until the batch is
 * full. While both have checkouts, each gets half the batch; one with fewer
 * leaves the rest to the other. The two never hold the same reservation: one
 * has an unsettled session, the other none.
 */
export async function findAbandonedCheckouts(
  now: Date,
  order: SQL = RANDOM_ORDER,
): Promise<AbandonedCheckout[]> {
  const [unsettled, settled] = await Promise.all([
    abandonedCheckoutsQuery(now, order),
    settledCheckoutsQuery(now, order),
  ]);
  const batch: AbandonedCheckout[] = [];
  for (let index = 0; batch.length < ABANDONED_CHECKOUTS_PER_RUN; index += 1) {
    const first = unsettled[index];
    const second = settled[index];
    if (!first && !second) break;
    if (first) batch.push({ ...first, branch: "unsettled" });
    if (second && batch.length < ABANDONED_CHECKOUTS_PER_RUN) {
      batch.push({ ...second, branch: "settled" });
    }
  }
  return batch;
}

const reachAfter = (now: Date) => new Date(now.getTime() - ABANDONED_CHECKOUT_REACH_MS);
const lookBefore = (now: Date) =>
  new Date(now.getTime() - CHECKOUT_SESSION_LIFETIME_SECONDS * 1000 - LOOK_AFTER_LIFETIME_MS);

/**
 * One checkout. One drawn for its settled sessions is read nowhere: its
 * cancellation is asked for at once. Otherwise each unsettled rental session old
 * enough to be over is read at Stripe, never expired: past its lifetime a session
 * cannot be open. One read
 * `expired` is marked: a `pending` row through the `checkout.session.expired`
 * handler's own write (cancelled, marked, its line), a `cancelled` one alone. One
 * paid is recorded as the customer's return records it. One unread, or still
 * open, leaves the reservation to the next run. Then the checkout's cancellation
 * is asked for, under the reservation's lock: it cancels only a checkout with no
 * rental payment pending or completed and no unsettled session.
 */
export async function settleAbandonedCheckout(
  checkout: { id: string; storeId: string; branch?: AbandonedCheckoutBranch },
  {
    now = new Date(),
    request = ABANDONED_CHECKOUT_READ,
    stop,
  }: { now?: Date; request?: CheckoutSessionReadOptions; stop?: () => boolean } = {},
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
  // A checkout drawn for its settled sessions is read nowhere: its cancellation
  // is asked for at once, and its guard decides.
  for (const row of checkout.branch === "settled" ? [] : rows) {
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
  const states = await readCheckoutSessionStates(sessions, { expire: false, request, stop });

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

  // The cancellation names the checkout's newest session, never a payment request's.
  const [newest] = rows
    .filter(isCheckoutSessionRow)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
 * The cron's pass over abandoned checkouts: those with an unsettled session to
 * read at Stripe, and those whose sessions are all settled, with no payment
 * left, to cancel (`findAbandonedCheckouts`). Each checkout is its own unit: one
 * that fails is counted and the others go on. Which of the two questions goes
 * first is drawn for each run (`first`). Once its time budget is spent it takes no new checkout
 * and reads no further session of the one it is on: those left wait for the
 * next run. It holds no
 * transaction across a Stripe call, and two runs at once write each record once:
 * the conditional updates and the reservation's lock make the second a no-op. A
 * run that left checkouts unread, failed or waiting logs one line: its counts and
 * a few of their ids. `order`, `clock`, `request` and `first` are for tests.
 */
export async function settleAbandonedCheckouts({
  now = new Date(),
  order,
  clock = Date.now,
  request = ABANDONED_CHECKOUT_READ,
  first = Math.random() < 0.5 ? "settled" : "unsettled",
}: {
  now?: Date;
  order?: SQL;
  clock?: () => number;
  request?: CheckoutSessionReadOptions;
  first?: AbandonedCheckoutBranch;
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
  const spent = () => clock() >= deadline;
  // Which question's checkouts go first is drawn for each run. Either can
  // spend a run's budget on its own (sessions that answer at their timeout; a
  // cancellation waiting for a reservation's lock), so neither is always
  // first: the other is kept waiting k runs in a row with probability 2^-k.
  const batch = await findAbandonedCheckouts(now, order);
  const ordered = [
    ...batch.filter(({ branch }) => branch === first),
    ...batch.filter(({ branch }) => branch !== first),
  ];
  for (const checkout of ordered) {
    if (spent()) {
      counts.waiting += 1;
      skipped.push(checkout.id);
      continue;
    }
    try {
      const outcome = await settleAbandonedCheckout(checkout, { now, request, stop: spent });
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

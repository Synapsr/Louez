import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  db,
  isUnsettledCheckoutSession,
  markCheckoutSessionSettled,
  markReservation,
  payments,
  reservationActivity,
  reservations,
  runReservationOnlyChange,
  stores,
  type Transaction,
} from "@louez/db";

import { log } from "@/lib/evlog";
import {
  checkoutSessionAccount,
  isSessionCreationRow,
} from "@/lib/reservations/checkout-session-account";
import {
  type CheckoutSessionAtStripe,
  readCheckoutSessionStates,
  recordPaidCheckoutSession,
} from "@/lib/reservations/checkout-session-settlement";
import { hasRentalPaymentInProgress } from "@/lib/reservations/util.payment-status";
import { fromStripeCents } from "@/lib/stripe";
import { getStripe } from "@/lib/stripe/client";

/**
 * The one gate a Checkout Session of a reservation's rental goes through, from
 * either door: the customer's own payment session (`payment-session.ts`) and the
 * store's payment request (`/pay/[reservationId]`). A reservation has at most one
 * open rental attempt: a `rental` payment row, `pending`, naming its session.
 *
 * 1. Under the reservation's lock, the door's check, then the rental's open
 *    payments cancelled. Their sessions, and every earlier one Stripe has not said
 *    is over (`isUnsettledCheckoutSession`), are read after the commit.
 * 2. Each such session expired at Stripe, or read when it no longer expires: one
 *    over is marked settled; one paid is recorded and nothing is opened; one whose
 *    state is unknown opens nothing, and the next call asks again.
 * 3. The door's session created, with an idempotency key fresh for this call.
 * 4. Under the reservation's lock again, the door's check, then the attempt
 *    installed as the pending row, only when no other rental payment is open and
 *    no session may still be paid; otherwise the session just created is expired.
 *
 * A write that lowers what the customer owes expires, through the same first two
 * steps, the sessions it leaves open (`expireRentalSessions`).
 *
 * Locks: the reservation's row, then its payments, as every writer of them.
 */

/** The reservation as its lock holds it, for the door's check. */
export interface LockedReservation {
  status: string;
  totalAmount: string;
  currency: string | null;
  payments: (typeof payments.$inferSelect)[];
}

/** What the gate itself refuses: an earlier session was paid, or one may still be. */
export type GateRefusal = "paid" | "busy";

export type RentalSessionOutcome<Refusal extends string, Session> =
  | { ok: true; session: Session }
  | { ok: false; refusal: Refusal | GateRefusal };

interface OpenRentalSessionInput<Refusal extends string, Session extends { sessionId: string }> {
  storeId: string;
  reservationId: string;
  /** The store's connected account: the new session's, and an older row's that records none. */
  stripeAccountId: string;
  /**
   * The verified marketplace only: its caller holds the booking's attempt, so the
   * gate runs without the reservation's lock, and a session found paid is left to
   * its completion (see `payment-session.ts`).
   */
  callerHoldsMarketplaceAttempt?: boolean;
  /**
   * The door's refusal, decided on the reservation as its lock holds it (null when
   * the reservation is gone); null when payable.
   */
  check: (tx: Transaction, locked: LockedReservation | null) => Promise<Refusal | null>;
  /** Creates the session at Stripe, sent with `idempotencyKey`. */
  create: (attempt: { idempotencyKey: string }) => Promise<Session>;
  /** The attempt's pending row: what its session charges, and where it comes from. */
  attempt: {
    /** The session's charge, in the currency's minor units: the row states it in its precision. */
    chargeMinor: number;
    currency: string;
    origin: "customer_session" | "payment_request";
    paymentRequestId?: string;
    /** The `payment_initiated` line's own fields. */
    activity: Record<string, unknown>;
  };
}

/** A rental session to settle at Stripe: its payment row, on the account it lives on. */
type RowSession = CheckoutSessionAtStripe & { paymentId: string };

/**
 * Under the reservation's lock, of `rows`, its payments: the rental's open ones
 * (`pending`) cancelled, by an update conditional on `pending`, before their
 * sessions are expired at Stripe, so an expiry of one finds its row no longer
 * pending and cancels nothing. A row so cancelled stays `cancelled`. Returns the
 * unsettled sessions among `rows` (`isUnsettledCheckoutSession`), each on the
 * account its row records, the one it was created on; a row that records none,
 * on the store's.
 */
async function cancelOpenRentalPayments(
  tx: Transaction,
  { reservationId, storeId }: { reservationId: string; storeId: string },
  rows: readonly (typeof payments.$inferSelect)[],
  storeAccountId: string | null,
): Promise<RowSession[]> {
  const open = rows.filter((payment) => payment.type === "rental" && payment.status === "pending");
  for (const payment of open) {
    await tx
      .update(payments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
  }
  if (open.length > 0) await markReservation(tx, { id: reservationId, storeId });
  return rows.filter(isUnsettledCheckoutSession).flatMap((payment) => {
    const account = checkoutSessionAccount({
      recordedAccountId: isSessionCreationRow(payment) ? payment.stripeAccountId : null,
      storeAccountId,
    });
    return payment.stripeCheckoutSessionId && account
      ? [{ paymentId: payment.id, sessionId: payment.stripeCheckoutSessionId, account }]
      : [];
  });
}

/**
 * Each session expired at Stripe, or read when it no longer expires: one over is
 * marked settled; one paid is recorded as Stripe took it (`recordPaidCheckoutSession`),
 * unless `record` is off. Says whether one was paid, and whether one's state is
 * unknown (still open, or Stripe not reached).
 */
async function settleRentalSessions(
  sessions: readonly RowSession[],
  { storeId, reservationId, record }: { storeId: string; reservationId: string; record: boolean },
): Promise<{ paid: boolean; unknown: boolean }> {
  const states = await readCheckoutSessionStates(sessions, { expire: true });
  for (const { paymentId, state } of states) {
    if (state === "expired") await markCheckoutSessionSettled(db, paymentId);
  }
  const paid = states.filter(({ state }) => state === "complete");
  if (record) {
    for (const { sessionId } of paid) {
      try {
        await recordPaidCheckoutSession({ storeId, reservationId, sessionId });
      } catch (error) {
        log.error({
          checkout: {
            event: "paid_session_record_failed",
            reservationId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }
  return { paid: paid.length > 0, unknown: states.some(({ state }) => state === "unknown") };
}

/**
 * The sender of `payment.rentalSessionsExpiry` (packages/api
 * services/rental-sessions.ts): the sessions a write that lowered the balance
 * left open, settled as the gate's first two steps settle the ones it replaces,
 * among those rows only (a session opened since charges the new balance). One
 * Stripe already took is recorded as it is: the dashboard shows what was paid
 * beyond the total. It throws while a session's state is unknown, so the outbox
 * tries again.
 */
export async function expireRentalSessions(
  {
    storeId,
    reservationId,
    paymentIds,
  }: {
    storeId: string;
    reservationId: string;
    paymentIds: readonly string[];
  },
  assertClaim: () => Promise<void>,
): Promise<{ skipped: string } | undefined> {
  if (paymentIds.length === 0) return { skipped: "no_session" };
  const store = await db.query.stores.findFirst({
    columns: { stripeAccountId: true },
    where: eq(stores.id, storeId),
  });
  const sessions = await runReservationOnlyChange({ reservationId, storeId }, async (tx) => {
    const rows = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.reservationId, reservationId), inArray(payments.id, [...paymentIds])));
    return cancelOpenRentalPayments(
      tx,
      { reservationId, storeId },
      rows,
      store?.stripeAccountId ?? null,
    );
  });
  if (sessions.length === 0) return { skipped: "sessions_settled" };
  await assertClaim();
  const { unknown } = await settleRentalSessions(sessions, {
    storeId,
    reservationId,
    record: true,
  });
  if (unknown) throw new Error("A rental session's state at Stripe is unknown");
  return undefined;
}

/** Expires a session the gate created and will not hand out: it is open, or gone. */
async function expireSession(sessionId: string, stripeAccount: string): Promise<void> {
  try {
    await getStripe().checkout.sessions.expire(sessionId, { stripeAccount });
  } catch {
    // Session may already be expired or completed.
  }
}

export async function openRentalCheckoutSession<
  Refusal extends string,
  Session extends { sessionId: string },
>({
  storeId,
  reservationId,
  stripeAccountId,
  callerHoldsMarketplaceAttempt = false,
  check,
  create,
  attempt,
}: OpenRentalSessionInput<Refusal, Session>): Promise<RentalSessionOutcome<Refusal, Session>> {
  const scope = { reservationId, storeId };
  const underLock = <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
    callerHoldsMarketplaceAttempt
      ? db.transaction(work, { isolationLevel: "read committed" })
      : runReservationOnlyChange(scope, (tx) => work(tx));
  const readLocked = async (
    tx: Transaction,
  ): Promise<
    { payable: false; refusal: Refusal } | { payable: true; locked: LockedReservation }
  > => {
    const [row] = await tx
      .select({
        status: reservations.status,
        totalAmount: reservations.totalAmount,
        currency: reservations.currency,
      })
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.storeId, storeId)));
    const rows = row
      ? await tx.select().from(payments).where(eq(payments.reservationId, reservationId))
      : [];
    const locked = row ? { ...row, payments: rows } : null;
    const refusal = await check(tx, locked);
    if (refusal !== null) return { payable: false, refusal };
    // A door that accepts a reservation gone is a door's bug: nothing is written for it.
    if (!locked) throw new Error("Reservation not found under its lock");
    return { payable: true, locked };
  };

  // 1. The door's check, then the rental's open payments cancelled
  // (`cancelOpenRentalPayments`).
  const replaced = await underLock<{ refusal: Refusal | null; sessions: RowSession[] }>(
    async (tx) => {
      const read = await readLocked(tx);
      if (!read.payable) return { refusal: read.refusal, sessions: [] };
      return {
        refusal: null,
        sessions: await cancelOpenRentalPayments(tx, scope, read.locked.payments, stripeAccountId),
      };
    },
  );
  if (replaced.refusal !== null) return { ok: false, refusal: replaced.refusal };

  // 2. A new session only when each of those is known to be over. Recording one
  // paid takes the reservation's lock, which the marketplace's caller cannot wait
  // for: there it is left to the session's completion.
  const settled = await settleRentalSessions(replaced.sessions, {
    storeId,
    reservationId,
    record: !callerHoldsMarketplaceAttempt,
  });
  if (settled.paid) return { ok: false, refusal: "paid" };
  if (settled.unknown) return { ok: false, refusal: "busy" };

  // 3. A fresh key for this call: the client's own retries of this one create find
  // the same session; it never ties two calls together, which the lock and the
  // install keep apart.
  const paymentId = nanoid();
  const session = await create({ idempotencyKey: `checkout-session:${paymentId}` });

  // 4. The pending payment and its activity land together, and only on a
  // reservation the door's check still accepts, with no other open rental payment
  // and no unsettled rental session (another call may have opened one meanwhile).
  let refusal: Refusal | GateRefusal | null;
  try {
    refusal = await underLock(async (tx) => {
      const read = await readLocked(tx);
      if (!read.payable) return read.refusal;
      if (
        hasRentalPaymentInProgress(read.locked.payments) ||
        read.locked.payments.some(isUnsettledCheckoutSession)
      ) {
        return "busy";
      }
      const now = new Date();
      await tx.insert(payments).values({
        id: paymentId,
        reservationId,
        // What the session charges, not what was asked: yen have no decimals.
        amount: fromStripeCents(attempt.chargeMinor, attempt.currency).toFixed(2),
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: session.sessionId,
        // The account the session was created on: its lifecycle is read on it.
        stripeAccountId,
        origin: attempt.origin,
        paymentRequestId: attempt.paymentRequestId ?? null,
        currency: attempt.currency,
        createdAt: now,
        updatedAt: now,
      });
      await markReservation(tx, { id: reservationId, storeId });
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId,
        activityType: "payment_initiated",
        metadata: { checkoutSessionId: session.sessionId, ...attempt.activity },
        createdAt: now,
      });
      return null;
    });
  } catch (error) {
    await expireSession(session.sessionId, stripeAccountId);
    throw error;
  }
  if (refusal !== null) {
    await expireSession(session.sessionId, stripeAccountId);
    return { ok: false, refusal };
  }
  return { ok: true, session };
}

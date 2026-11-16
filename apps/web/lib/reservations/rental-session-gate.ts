import "server-only";

import { and, eq } from "drizzle-orm";
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
 * 3. The door's session created, with an idempotency key of the attempt.
 * 4. Under the reservation's lock again, the door's check, then the attempt
 *    installed as the pending row, only when no other rental payment is open and
 *    no session may still be paid; otherwise the session just created is expired.
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
  /** The attempt's pending row: what it asks, and where it comes from. */
  attempt: {
    amount: string;
    currency: string;
    origin: "customer_session" | "payment_request";
    paymentRequestId?: string;
    /** The `payment_initiated` line's own fields. */
    activity: Record<string, unknown>;
  };
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

  // 1. The rental's open payments are cancelled before their sessions are expired
  // at Stripe: an expiry of a session replaced here finds its row no longer
  // pending and cancels nothing. A row so cancelled stays `cancelled`.
  const replaced = await underLock<{
    refusal: Refusal | null;
    sessions: Array<CheckoutSessionAtStripe & { paymentId: string }>;
  }>(async (tx) => {
    const read = await readLocked(tx);
    if (!read.payable) return { refusal: read.refusal, sessions: [] };
    const open = read.locked.payments.filter(
      (payment) => payment.type === "rental" && payment.status === "pending",
    );
    for (const payment of open) {
      await tx
        .update(payments)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
    }
    if (open.length > 0) await markReservation(tx, { id: reservationId, storeId });
    return {
      refusal: null,
      // Each session on the account its row records, the one it was created on;
      // a row that records none, on the store's.
      sessions: read.locked.payments.filter(isUnsettledCheckoutSession).flatMap((payment) =>
        payment.stripeCheckoutSessionId
          ? [
              {
                paymentId: payment.id,
                sessionId: payment.stripeCheckoutSessionId,
                account: checkoutSessionAccount({
                  recordedAccountId: isSessionCreationRow(payment) ? payment.stripeAccountId : null,
                  storeAccountId: stripeAccountId,
                }),
              },
            ]
          : [],
      ),
    };
  });
  if (replaced.refusal !== null) return { ok: false, refusal: replaced.refusal };

  // 2. A new session only when each of those is known to be over.
  const states = await readCheckoutSessionStates(replaced.sessions, { expire: true });
  for (const { paymentId, state } of states) {
    if (state === "expired") await markCheckoutSessionSettled(db, paymentId);
  }
  const paid = states.filter(({ state }) => state === "complete");
  if (paid.length > 0) {
    // Recording takes the reservation's lock, which the marketplace's caller
    // cannot wait for: there it is left to the session's completion.
    if (!callerHoldsMarketplaceAttempt) {
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
    return { ok: false, refusal: "paid" };
  }
  if (states.some(({ state }) => state === "unknown")) return { ok: false, refusal: "busy" };

  // 3. The attempt's key: a retry of this create finds the same session.
  const paymentId = nanoid();
  const session = await create({ idempotencyKey: `checkout-session:${paymentId}` });

  // 4. The pending payment and its activity land together, and only on a
  // reservation still payable, with no other open or paid rental payment and no
  // unsettled rental session (another call may have opened one meanwhile).
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
        amount: attempt.amount,
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

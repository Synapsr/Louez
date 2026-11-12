import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { type Database, customers, markReservationIds, payments, reservations } from "@louez/db";
import type { StoreSettings } from "@louez/types";
import { getCurrencySymbol } from "@louez/utils";

import { log } from "@/lib/evlog";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { fromStripeCents, toStripeCents } from "@/lib/stripe";

import {
  type DepositAuthorizationAnswer,
  type DepositHoldStripe,
  depositHoldIdempotencyKey,
  findAttemptIntent,
} from "./deposit-hold-stripe";
import { settleAbsentAttempt, settleDepositIntent } from "./deposit-hold-writes";
import { type DepositIntent, intentStateOf } from "./util.deposit-hold-transition";

// A deposit hold (empreinte bancaire) is an authorization on the customer's card. The
// store asks for one from the dashboard or through an agent; the customer gives one on
// the storefront. This file is the orchestration of what the store asks: it claims the
// attempt, asks Stripe, and hands what Stripe says to the writer. Four files hold a
// deposit hold, and each rule lives in one of them:
//
// - util.deposit-hold-transition.ts decides. A pure function gives what is written for
//   a PaymentIntent, from the state of its hold row, its state at Stripe and what the
//   reservation references.
// - deposit-hold-writes.ts writes. `settleDepositIntent` is the one writer: the store's
//   request, the customer's page, the Connect webhook and the outbox's release all go
//   through it, under the reservation's row lock.
// - deposit-hold-stripe.ts reaches Stripe: the requests, what a failed one tells, the
//   search for an attempt's PaymentIntent.
// - this file claims, asks and reconciles.
//
// The store's request is an attempt, claimed before Stripe is called: a `pending` hold
// row written under the reservation's row lock. Its id is the attempt: it is Stripe's
// idempotency key and it travels in the PaymentIntent's metadata. The row keeps the
// connected account it was sent to: every later call about it goes to that account.
//
// An attempt whose outcome is not known is never replaced. It stays `pending`, is
// asked again with the same key, and is settled by a lookup or by the webhook, until
// Stripe shows its PaymentIntent or is proven never to have made one. No age closes
// it: a reservation whose attempt nobody can settle takes no new one, and says so.

/**
 * How long an attempt belongs to the request that claimed it: longer than its Stripe
 * calls may take (deposit-hold-stripe.ts). A request that ends gives it back at once;
 * one whose process died keeps it until then. Counted on the database's clock.
 */
export const DEPOSIT_HOLD_CLAIM_SECONDS = 120;

/**
 * Stripe may forget an idempotency key once it is 24 hours old, and would then
 * authorize again. An attempt created longer ago than this is looked up, never sent.
 */
const KEY_SENDABLE_HOURS = 23;

/**
 * How long after its last request an attempt may still get its PaymentIntent from a
 * request Stripe answered nothing certain to: the life of the key. Before that, a
 * search that finds none proves nothing.
 */
const KEY_WINDOW_HOURS = 24;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type DepositHoldDeps = {
  readonly database: Database;
  readonly stripe: DepositHoldStripe;
  /** Runs outbox rows a write added, after its commit; the cron runs what this misses. */
  readonly dispatchEffects: (ids: readonly string[]) => void;
};

/**
 * Cancels at Stripe an authorization, and answers the PaymentIntent as it is then.
 * One Stripe will not cancel because it was captured is answered as captured: there
 * is nothing left to release, and its capture is to be recorded.
 */
async function releaseAtStripe(
  stripe: DepositHoldStripe,
  accountId: string,
  paymentIntentId: string,
): Promise<DepositIntent> {
  try {
    return await stripe.release(accountId, paymentIntentId);
  } catch (error) {
    const intent = await stripe.readIntent(accountId, paymentIntentId);
    if (intentStateOf(intent.status) !== "captured") throw error;
    return intent;
  }
}

/**
 * The work of a `deposit.holdRelease` outbox row: cancels at Stripe the authorization
 * Louez decided against, and records what Stripe answers. It throws while Stripe has
 * not answered, so the outbox tries again, with its backoff and its bound; a release
 * already made, by Stripe or by an earlier run, is success. A hold whose row is gone
 * with its reservation is released all the same: the card is what matters.
 */
export async function releaseOwedHold(
  deps: Pick<DepositHoldDeps, "database" | "stripe">,
  owed: {
    readonly reservationId: string;
    readonly paymentId: string;
    readonly accountId: string;
    readonly paymentIntentId: string;
  },
  beforeStripe: () => Promise<void> = async () => {},
): Promise<{ readonly skipped: string } | undefined> {
  const [row] = await deps.database
    .select({ releaseOwedAt: payments.releaseOwedAt })
    .from(payments)
    .where(and(eq(payments.id, owed.paymentId), eq(payments.type, "deposit_hold")));
  // Stripe said since that the authorization is cancelled, or captured.
  if (row && row.releaseOwedAt === null) return { skipped: "The release is no longer owed." };

  await beforeStripe();
  const intent = await releaseAtStripe(deps.stripe, owed.accountId, owed.paymentIntentId);
  const settled = await settleDepositIntent(deps.database, {
    reservationId: owed.reservationId,
    accountId: owed.accountId,
    intent,
    actorUserId: null,
  });
  if (settled.status === "refused") {
    throw new Error(`The release of ${owed.paymentIntentId} was not recorded: ${settled.reason}.`);
  }
  return undefined;
}

export type DepositHoldError =
  | "errors.reservationNotFound"
  | "errors.stripe.noSavedCard"
  | "errors.stripe.invalidDepositStatus"
  | "errors.stripe.noDepositRequired"
  /** Another request holds the attempt: nothing was sent to Stripe. Retry later. */
  | "errors.stripe.authorizationInProgress"
  /** What Stripe did is unknown. The attempt is kept: a retry asks about the same one. */
  | "errors.stripe.authorizationUnconfirmed"
  /** Stripe holds nothing: the card was declined or needs the customer. */
  | "errors.stripe.authorizationFailed";

export type DepositHoldResult =
  | {
      readonly ok: true;
      readonly paymentIntentId: string;
      readonly amount: number;
      readonly currency: string;
    }
  | { readonly ok: false; readonly error: DepositHoldError };

export type DepositHoldInput = {
  readonly reservationId: string;
  readonly storeId: string;
  /** The store's connected account today: a new attempt is sent to it. */
  readonly stripeAccountId: string;
  /** The store's currency, for a reservation older than its own (contract Q4). */
  readonly storeSettings: Pick<StoreSettings, "currency"> | null;
  readonly actorUserId: string | null;
};

type Attempt = {
  readonly id: string;
  /** False for an attempt an earlier request left unsettled. */
  readonly fresh: boolean;
  /** The PaymentIntent the attempt is known to have, still undecided at Stripe. */
  readonly paymentIntentId: string | null;
  /** Whether the request is sent: Stripe still knows its key, or never saw it. */
  readonly send: boolean;
  /** Whether the key's life is over since the last request: nothing more can come of it. */
  readonly windowOver: boolean;
  /** The connected account the attempt was first sent to. */
  readonly accountId: string;
  readonly amount: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentMethodId: string;
  readonly customerId: string | null;
  readonly reservationNumber: string;
  readonly customerName: string | null;
};

const refusal = (error: DepositHoldError) => ({ ok: false as const, error });

const hours = (count: number) => sql.raw(String(count));

/**
 * Claims the reservation's attempt under its row lock: the pending one an earlier
 * request left, with the amount, currency, card and account it was sent with, or a new
 * one. An attempt another request still holds is refused.
 *
 * The claim, the age of the key and the time of the last request are read and written
 * on the database's clock, in the statements that follow the lock: an app server whose
 * clock is off neither takes over a live attempt nor misdates a request.
 */
async function claimAttempt(
  input: DepositHoldInput,
  database: Database,
): Promise<Attempt | { readonly ok: false; readonly error: DepositHoldError }> {
  return database.transaction(async (tx) => {
    const [reservation] = await tx
      .select({
        number: reservations.number,
        customerId: reservations.customerId,
        currency: reservations.currency,
        depositAmount: reservations.depositAmount,
        depositStatus: reservations.depositStatus,
        stripeCustomerId: reservations.stripeCustomerId,
        stripePaymentMethodId: reservations.stripePaymentMethodId,
      })
      .from(reservations)
      .where(and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)))
      .for("update");
    if (!reservation) return refusal("errors.reservationNotFound");

    // Read after the lock: every writer of a hold row holds it.
    const [pending] = await tx
      .select({
        id: payments.id,
        paymentIntentId: payments.stripePaymentIntentId,
        amount: payments.amount,
        currency: payments.currency,
        amountMinor: payments.grossMinor,
        paymentMethodId: payments.stripePaymentMethodId,
        accountId: payments.stripeAccountId,
        claimed: sql<number | null>`${payments.claimedUntil} > NOW()`,
        keySendable: sql<number>`${payments.createdAt} > NOW() - INTERVAL ${hours(KEY_SENDABLE_HOURS)} HOUR`,
        windowOver: sql<number>`${payments.providerRequestedAt} IS NULL OR ${payments.providerRequestedAt} < NOW() - INTERVAL ${hours(KEY_WINDOW_HOURS)} HOUR`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, input.reservationId),
          eq(payments.type, "deposit_hold"),
          eq(payments.status, "pending"),
        ),
      )
      .orderBy(payments.createdAt)
      .limit(1);
    const [customer] = await tx
      .select({ firstName: customers.firstName, lastName: customers.lastName })
      .from(customers)
      .where(eq(customers.id, reservation.customerId));
    const reference = {
      customerId: reservation.stripeCustomerId,
      reservationNumber: reservation.number,
      customerName: customer ? `${customer.firstName} ${customer.lastName}` : null,
    };

    if (pending) {
      if (Number(pending.claimed) === 1) return refusal("errors.stripe.authorizationInProgress");
      const { currency, amountMinor, paymentMethodId, accountId } = pending;
      // What an attempt is written with, below.
      if (!currency || amountMinor === null || !paymentMethodId || !accountId) {
        return refusal("errors.stripe.invalidDepositStatus");
      }
      const send =
        pending.paymentIntentId === null &&
        Number(pending.keySendable) === 1 &&
        Boolean(reference.customerId);
      await tx
        .update(payments)
        .set({
          claimedUntil: sql`NOW() + INTERVAL ${sql.raw(String(DEPOSIT_HOLD_CLAIM_SECONDS))} SECOND`,
          // Written before the request leaves: a process that dies leaves its date.
          providerRequestedAt: send ? sql`NOW()` : undefined,
          updatedAt: sql`NOW()`,
        })
        .where(eq(payments.id, pending.id));
      return {
        ...reference,
        id: pending.id,
        fresh: false,
        paymentIntentId: pending.paymentIntentId,
        send,
        windowOver: Number(pending.windowOver) === 1,
        accountId,
        amount: pending.amount,
        amountMinor,
        currency,
        paymentMethodId,
      };
    }

    if (!reservation.stripeCustomerId || !reservation.stripePaymentMethodId) {
      return refusal("errors.stripe.noSavedCard");
    }
    if (reservation.depositStatus !== "card_saved") {
      return refusal("errors.stripe.invalidDepositStatus");
    }
    const depositAmount = Number.parseFloat(reservation.depositAmount);
    if (!(depositAmount > 0)) return refusal("errors.stripe.noDepositRequired");

    // The deposit was agreed in the reservation's currency, whatever the store's is now.
    const currency = reservationCurrency(reservation.currency, input.storeSettings);
    const attempt = {
      ...reference,
      id: nanoid(),
      fresh: true,
      paymentIntentId: null,
      send: true,
      windowOver: false,
      accountId: input.stripeAccountId,
      amount: depositAmount.toFixed(2),
      amountMinor: toStripeCents(depositAmount, currency),
      currency,
      paymentMethodId: reservation.stripePaymentMethodId,
    };
    await tx.insert(payments).values({
      id: attempt.id,
      reservationId: input.reservationId,
      amount: attempt.amount,
      type: "deposit_hold",
      method: "stripe",
      status: "pending",
      stripePaymentMethodId: attempt.paymentMethodId,
      stripeAccountId: attempt.accountId,
      currency,
      grossMinor: attempt.amountMinor,
      insuranceShareMinor: 0,
      origin: "deposit",
      claimedUntil: sql`NOW() + INTERVAL ${sql.raw(String(DEPOSIT_HOLD_CLAIM_SECONDS))} SECOND`,
      providerRequestedAt: sql`NOW()`,
      createdAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    });
    await markReservationIds(tx, [input.reservationId]);
    return attempt;
  });
}

type StripeVerdict =
  /** The attempt's PaymentIntent, as Stripe has it now; `refusal` when Stripe said why it holds nothing. */
  | { readonly kind: "intent"; readonly intent: DepositIntent; readonly refusal?: string }
  /**
   * Stripe is proven never to have made a PaymentIntent for the attempt. `refusal`
   * when it said no to the request.
   */
  | { readonly kind: "absent"; readonly refusal: string | null }
  /** Stripe may hold an authorization for the attempt, or may yet: nobody can tell now. */
  | { readonly kind: "unknown" };

/**
 * What Stripe has for the attempt. A fresh attempt is sent. One left unsettled is sent
 * again with the same key and the same parameters, so Stripe answers for the first
 * request, then its PaymentIntent is read as it is now.
 *
 * Whenever that tells nothing (a timeout, a Stripe error, the stored error of an
 * earlier request, a key sent with other parameters or too old to send), the
 * PaymentIntent is looked up at once. Finding none proves its absence only when
 * nothing can still make it: the search read every PaymentIntent of the card's
 * customer, and either Stripe refused the request, or the key's life is over since the
 * last request. A 500, also one Stripe replays for the key, is no refusal: Stripe may
 * still make the PaymentIntent of a request it answered 500 to. The attempt is kept.
 */
async function askStripe(
  attempt: Attempt,
  input: DepositHoldInput,
  stripe: DepositHoldStripe,
): Promise<StripeVerdict> {
  const { accountId } = attempt;
  if (attempt.paymentIntentId) {
    return { kind: "intent", intent: await stripe.readIntent(accountId, attempt.paymentIntentId) };
  }

  let refusedBecause: string | null = null;
  if (attempt.send && attempt.customerId) {
    let answer: DepositAuthorizationAnswer;
    try {
      answer = await stripe.authorize(
        {
          accountId,
          attemptId: attempt.id,
          customerId: attempt.customerId,
          paymentMethodId: attempt.paymentMethodId,
          amountMinor: attempt.amountMinor,
          currency: attempt.currency,
          reservationId: input.reservationId,
          reservationNumber: attempt.reservationNumber,
          customerName: attempt.customerName,
        },
        depositHoldIdempotencyKey(attempt.id),
      );
    } catch (error) {
      answer = { kind: "indeterminate", replayed: false, message: describeError(error) };
    }

    if (answer.kind === "created") {
      // The answer of a key sent again is the one of its first request.
      const intent = attempt.fresh
        ? answer.intent
        : await stripe.readIntent(accountId, answer.intent.paymentIntentId);
      return { kind: "intent", intent };
    }
    if (answer.kind === "refused") {
      if (answer.paymentIntentId) {
        const intent = await stripe.readIntent(accountId, answer.paymentIntentId);
        return { kind: "intent", intent, refusal: answer.message };
      }
      // Stripe refused this very request, which made nothing.
      if (attempt.fresh) return { kind: "absent", refusal: answer.message };
      // A refusal of a request sent again says what Stripe answered, not what an
      // earlier request left: that is looked up.
      refusedBecause = answer.message;
    }
    if (answer.kind === "indeterminate") {
      log.error(
        "deposit-hold",
        `attempt ${attempt.id} of reservation ${input.reservationId} got no answer${answer.replayed ? " (replayed)" : ""}: ${answer.message}`,
      );
    }
  }

  const found = await findAttemptIntent(stripe, attempt);
  if (found.kind === "found") return { kind: "intent", intent: found.intent };
  if (found.kind === "absent") {
    if (refusedBecause !== null) return { kind: "absent", refusal: refusedBecause };
    if (!attempt.send && attempt.windowOver) return { kind: "absent", refusal: null };
  }
  return { kind: "unknown" };
}

/** Gives the attempt back, so the next request asks Stripe about it at once. */
async function releaseClaim(database: Database, attempt: Attempt): Promise<void> {
  await database
    .update(payments)
    .set({ claimedUntil: null })
    .where(
      and(
        eq(payments.id, attempt.id),
        eq(payments.type, "deposit_hold"),
        eq(payments.status, "pending"),
      ),
    );
}

async function runAttempt(
  input: DepositHoldInput,
  deps: DepositHoldDeps,
): Promise<DepositHoldResult | "start_over"> {
  const { database, stripe } = deps;

  const attempt = await claimAttempt(input, database);
  if ("ok" in attempt) return attempt;

  const unconfirmed = async () => {
    // The attempt stays, and its key with it.
    await releaseClaim(database, attempt);
    return refusal("errors.stripe.authorizationUnconfirmed");
  };

  try {
    const verdict = await askStripe(attempt, input, stripe);
    if (verdict.kind === "unknown") return await unconfirmed();

    if (verdict.kind === "absent") {
      const closed = await settleAbsentAttempt(database, {
        reservationId: input.reservationId,
        storeId: input.storeId,
        attemptId: attempt.id,
        refusedBecause: verdict.refusal,
        actorUserId: input.actorUserId,
      });
      if (!closed) return await unconfirmed();
      return verdict.refusal === null ? "start_over" : refusal("errors.stripe.authorizationFailed");
    }

    const { intent } = verdict;
    const symbol = getCurrencySymbol(attempt.currency);
    const failure = verdict.refusal
      ? `Échec de l'empreinte: ${verdict.refusal}`
      : `Empreinte non capturable (statut Stripe: ${intent.status})`;
    const settled = await settleDepositIntent(database, {
      reservationId: input.reservationId,
      storeId: input.storeId,
      accountId: attempt.accountId,
      intent,
      actorUserId: input.actorUserId,
      failure,
      descriptions: {
        deposit_authorized: `Empreinte de ${attempt.amount}${symbol} créée`,
        deposit_failed: failure,
      },
    });
    if (settled.status === "reservation_not_found") return refusal("errors.reservationNotFound");
    if (settled.status === "refused") {
      log.error(
        "deposit-hold",
        `${intent.paymentIntentId} is not written on attempt ${attempt.id} of reservation ${input.reservationId}: ${settled.reason}`,
      );
      return await unconfirmed();
    }
    deps.dispatchEffects(settled.effectIds);

    switch (settled.outcome) {
      case "authorized":
        return {
          ok: true,
          paymentIntentId: intent.paymentIntentId,
          amount: Number(attempt.amount),
          currency: attempt.currency,
        };
      // The customer authorized the deposit meanwhile, or the attempt's own
      // authorization was captured at Stripe: one hold is enough.
      case "superseded":
      case "captured":
        return refusal("errors.stripe.invalidDepositStatus");
      case "failed":
        return refusal("errors.stripe.authorizationFailed");
      // Stripe cancelled what an earlier request got: the attempt is over with nothing
      // held, and its row says so. The request starts a new one.
      case "released":
        return attempt.fresh ? refusal("errors.stripe.authorizationFailed") : "start_over";
      case "pending":
      case "stale":
        return await unconfirmed();
    }
  } catch (error) {
    // Nothing was decided: the attempt stays, and its key with it.
    log.error(
      "deposit-hold",
      `attempt ${attempt.id} of reservation ${input.reservationId} was not settled: ${describeError(error)}`,
    );
    return await unconfirmed();
  }
}

/**
 * Creates the reservation's deposit hold on the card saved at checkout, for the
 * store. At most one authorization exists per attempt, and an attempt is never
 * replaced while its outcome is unknown: see the top of this file.
 */
export async function authorizeDepositHold(
  input: DepositHoldInput,
  deps: DepositHoldDeps,
): Promise<DepositHoldResult> {
  // An attempt that ended with nothing held is closed, and the request starts a new one.
  for (let run = 0; run < 2; run++) {
    const result = await runAttempt(input, deps);
    if (result !== "start_over") return result;
  }
  return refusal("errors.stripe.authorizationUnconfirmed");
}

export type DepositSettlementError =
  | "errors.reservationNotFound"
  | "errors.noStripeAccount"
  | "errors.stripe.noActiveAuthorization"
  | "errors.invalidAmount"
  | "errors.reasonRequired"
  | "errors.stripe.captureFailed"
  | "errors.stripe.releaseFailed";

export type DepositSettlementInput = {
  readonly reservationId: string;
  readonly storeId: string;
  /** The store's connected account today, for a hold whose row names none. */
  readonly fallbackAccountId: string | null;
  /** The store's currency, for a reservation older than its own (contract Q4). */
  readonly storeSettings: Pick<StoreSettings, "currency"> | null;
  readonly actorUserId: string | null;
};

/**
 * The hold the reservation references, and the connected account that holds it: the
 * one its row was written with, which is not the store's any more after it changed
 * accounts.
 */
async function loadReferencedHold(database: Database, input: DepositSettlementInput) {
  const [reservation] = await database
    .select({
      currency: reservations.currency,
      depositAmount: reservations.depositAmount,
      depositStatus: reservations.depositStatus,
      paymentIntentId: reservations.depositPaymentIntentId,
    })
    .from(reservations)
    .where(and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)));
  if (!reservation) return { ok: false as const, error: "errors.reservationNotFound" as const };
  const { paymentIntentId } = reservation;
  if (reservation.depositStatus !== "authorized" || !paymentIntentId) {
    return { ok: false as const, error: "errors.stripe.noActiveAuthorization" as const };
  }

  const [row] = await database
    .select({ accountId: payments.stripeAccountId })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, input.reservationId),
        eq(payments.type, "deposit_hold"),
        eq(payments.stripePaymentIntentId, paymentIntentId),
      ),
    )
    .limit(1);
  const accountId = row?.accountId ?? input.fallbackAccountId;
  if (!accountId) return { ok: false as const, error: "errors.noStripeAccount" as const };

  return {
    ok: true as const,
    paymentIntentId,
    accountId,
    depositAmount: Number.parseFloat(reservation.depositAmount),
    // The deposit the store sees, and any amount it types, are in the reservation's
    // currency, whatever the store's is now.
    currency: reservationCurrency(reservation.currency, input.storeSettings),
  };
}

export type DepositCaptureResult =
  | {
      readonly ok: true;
      readonly capturePaymentId: string | null;
      readonly amountCapturedMinor: number;
    }
  | { readonly ok: false; readonly error: DepositSettlementError };

/**
 * Captures part or all of the hold the reservation references, for damage or loss.
 * Stripe is asked about that PaymentIntent, and the capture is recorded on it: a hold
 * the reservation took meanwhile is not touched.
 *
 * The amount is sent in the hold's own currency, which Stripe states: a payment row may
 * hold the column's default, or two rows of one PaymentIntent may disagree. A hold in
 * another currency than the reservation's (authorized before the store changed its
 * own) cannot be read in it: nothing is captured or written, and the store captures it
 * from Stripe. What is recorded is what Stripe captured, in its currency.
 */
export async function captureDepositHold(
  input: DepositSettlementInput & { readonly amount: number; readonly reason: string },
  deps: DepositHoldDeps,
): Promise<DepositCaptureResult> {
  const hold = await loadReferencedHold(deps.database, input);
  if (!hold.ok) return hold;
  if (input.amount <= 0 || input.amount > hold.depositAmount) {
    return { ok: false, error: "errors.invalidAmount" };
  }
  if (!input.reason.trim()) return { ok: false, error: "errors.reasonRequired" };

  try {
    const held = await deps.stripe.readIntent(hold.accountId, hold.paymentIntentId);
    if (held.currency !== hold.currency) {
      log.warn(
        "deposit-hold",
        `capture refused for reservation ${input.reservationId}: its hold ${hold.paymentIntentId} is in ${held.currency}, its deposit in ${hold.currency}; capture it from Stripe`,
      );
      return { ok: false, error: "errors.stripe.captureFailed" };
    }

    const intent = await deps.stripe.capture(
      hold.accountId,
      hold.paymentIntentId,
      toStripeCents(input.amount, held.currency),
    );
    const capturedAmount = fromStripeCents(intent.capturedMinor, intent.currency);
    const settled = await settleDepositIntent(deps.database, {
      reservationId: input.reservationId,
      storeId: input.storeId,
      accountId: hold.accountId,
      intent,
      actorUserId: input.actorUserId,
      captureReason: input.reason,
      descriptions: {
        deposit_captured: `Caution capturée: ${capturedAmount.toFixed(2)}${getCurrencySymbol(intent.currency)} - ${input.reason}`,
      },
    });
    if (settled.status === "reservation_not_found") {
      return { ok: false, error: "errors.reservationNotFound" };
    }
    if (settled.status === "refused" || settled.outcome !== "captured") {
      log.error(
        "deposit-hold",
        `capture of ${hold.paymentIntentId} on reservation ${input.reservationId} was not recorded: ${settled.status === "refused" ? settled.reason : settled.outcome}`,
      );
      return { ok: false, error: "errors.stripe.captureFailed" };
    }
    return {
      ok: true,
      capturePaymentId: settled.capturePaymentId,
      amountCapturedMinor: intent.capturedMinor,
    };
  } catch (error) {
    log.error(
      "deposit-hold",
      `capture of ${hold.paymentIntentId} on reservation ${input.reservationId} failed: ${describeError(error)}`,
    );
    return { ok: false, error: "errors.stripe.captureFailed" };
  }
}

export type DepositReleaseResult =
  | { readonly ok: true; readonly amount: number }
  | { readonly ok: false; readonly error: DepositSettlementError };

/**
 * Releases the hold the reservation references. The release is recorded on the
 * PaymentIntent that was cancelled: when the reservation took another hold while
 * Stripe was answering, that hold stays, at Stripe and in Louez.
 */
export async function releaseDepositHold(
  input: DepositSettlementInput,
  deps: DepositHoldDeps,
): Promise<DepositReleaseResult> {
  const hold = await loadReferencedHold(deps.database, input);
  if (!hold.ok) return hold;

  try {
    const intent = await releaseAtStripe(deps.stripe, hold.accountId, hold.paymentIntentId);
    const settled = await settleDepositIntent(deps.database, {
      reservationId: input.reservationId,
      storeId: input.storeId,
      accountId: hold.accountId,
      intent,
      actorUserId: input.actorUserId,
      descriptions: {
        deposit_released: `Caution de ${hold.depositAmount.toFixed(2)}${getCurrencySymbol(hold.currency)} libérée`,
      },
    });
    if (settled.status === "reservation_not_found") {
      return { ok: false, error: "errors.reservationNotFound" };
    }
    // A capture that reached Stripe first is recorded, and nothing was released.
    if (settled.status === "refused" || settled.outcome !== "released") {
      return { ok: false, error: "errors.stripe.releaseFailed" };
    }
    return { ok: true, amount: hold.depositAmount };
  } catch (error) {
    log.error(
      "deposit-hold",
      `release of ${hold.paymentIntentId} on reservation ${input.reservationId} failed: ${describeError(error)}`,
    );
    return { ok: false, error: "errors.stripe.releaseFailed" };
  }
}

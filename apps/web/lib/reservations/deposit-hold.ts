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
import { closeAbsentAttempt, readHoldRows, settleDepositIntent } from "./deposit-hold-writes";
import {
  type DepositIntent,
  type HoldOutcome,
  type PastedIntentMismatch,
  intentStateOf,
  pastedIntentMismatches,
} from "./util.deposit-hold-transition";

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
// An attempt whose outcome is not known is not replaced while Stripe may still answer
// for it. It stays `pending`, is asked again with the same key, and is settled by a
// lookup or by the webhook, until Stripe shows its PaymentIntent, refuses the
// request, or a complete listing of its customer's PaymentIntents, made more than 24
// hours after its last request, holds none. Then it is closed: its row is kept,
// `failed`, and a new attempt may be asked for. Stripe does not promise to have
// reconciled a request it answered 500 to within 24 hours, so a closed attempt still
// reconciles: its PaymentIntent, should it show up, is recorded on its row, as the
// reservation's hold when it has none, or as a release owed (the outbox releases it)
// when it has another. A wrong verdict of absence thus costs at most a second hold,
// recorded and released, never one Louez does not know of.
//
// An attempt nothing can settle (its customer cannot be listed, it has more
// PaymentIntents than a lookup reads, its request never reached Stripe) is the
// store's to resolve (`resolveUnconfirmedAttempt`): it declares it found nothing at
// Stripe, which closes the attempt once Louez's own lookup, when it can make one,
// agrees, or it names the PaymentIntent, which is read and checked against the
// attempt before it is recorded.
//
// What is guaranteed, and what is not:
// - One attempt makes at most one PaymentIntent (its key), and every PaymentIntent
//   Stripe makes of it is recorded on its row, whenever it shows up.
// - The reservation references one hold at most; any other authorization Louez learns
//   of is recorded with its release owed, and the outbox, then the cron
//   (deposit-hold-debts.ts), ask Stripe for it until Stripe confirms.
// - Not closed here: the customer's own authorization page creates its PaymentIntent
//   with no attempt row and no idempotency key, and does not look at a pending store
//   attempt. Two holds can then exist; the second one Louez learns of is recorded
//   with its release owed, and released.
// - Not closed here: a customer's authorization made on a connected account the store
//   leaves before any confirmation or webhook recorded it has no row, and the events
//   of an account the store left are believed only for the rows that name it.
// - Where a PaymentIntent read from Stripe is checked: its reservation (metadata) and
//   its capture method on every write (`bindDepositIntent`). On a row that already
//   names it, the account only: the id is Stripe's own and the row was written from
//   that PaymentIntent read on that account, while its amount, currency and card are
//   not compared, since rows written before this code may hold the column's default
//   currency, and refusing the capture or the release of a recorded hold would leave
//   money unrecorded. On an attempt it answers, the account, the amount, the
//   currency, the card and that it has a customer. On a PaymentIntent the store names,
//   the same, its customer as the attempt stored it, and the attempt's id and
//   reservation in its metadata when present (`pastedIntentMismatches`).

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
  /** The customer the request is sent with. */
  readonly customerId: string | null;
  /** The customer the attempt row stored; null on an attempt claimed before the column. */
  readonly storedCustomerId: string | null;
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
        customerId: payments.stripeCustomerId,
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
      storedCustomerId: reservation.stripeCustomerId,
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
      // Sent again as it was first sent: with the customer it stored.
      const customerId = pending.customerId ?? reference.customerId;
      const send =
        pending.paymentIntentId === null &&
        Number(pending.keySendable) === 1 &&
        Boolean(customerId);
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
        customerId,
        storedCustomerId: pending.customerId,
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
      stripeCustomerId: attempt.customerId,
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

  const found = await findAttemptIntent(stripe, {
    id: attempt.id,
    accountId,
    paymentMethodId: attempt.paymentMethodId,
    customerId: attempt.storedCustomerId,
  });
  if (found.kind === "found") return { kind: "intent", intent: found.intent };
  if (found.kind === "absent") {
    if (refusedBecause !== null) return { kind: "absent", refusal: refusedBecause };
    if (!attempt.send && attempt.windowOver) return { kind: "absent", refusal: null };
  }
  return { kind: "unknown" };
}

/** Gives the attempt back, so the next request asks Stripe about it at once. */
async function releaseClaim(database: Database, attempt: { readonly id: string }): Promise<void> {
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
      const closed = await closeAbsentAttempt(database, {
        reservationId: input.reservationId,
        storeId: input.storeId,
        attemptId: attempt.id,
        closure:
          verdict.refusal === null
            ? { kind: "not_found" }
            : { kind: "refused", message: verdict.refusal },
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

/** What the store says of an attempt Stripe has not confirmed. */
export type AttemptResolution =
  /** It checked its Stripe dashboard and found no authorization for it. */
  | { readonly kind: "nothing_at_stripe" }
  /** This PaymentIntent, as its Stripe dashboard shows it, is the attempt's. */
  | { readonly kind: "payment_intent"; readonly paymentIntentId: string };

export type AttemptResolutionResult =
  /** The attempt is closed: a new hold may be asked for. */
  | { readonly ok: true; readonly outcome: "closed"; readonly paymentIntentId: null }
  /** The named PaymentIntent was recorded as Stripe has it. */
  | {
      readonly ok: true;
      readonly outcome: Exclude<HoldOutcome, "stale">;
      readonly paymentIntentId: string;
    }
  | {
      readonly ok: false;
      readonly error:
        | "reservation_not_found"
        /** No attempt of the reservation waits for Stripe: nothing to resolve. */
        | "no_unconfirmed_attempt"
        /** A request is asking Stripe about the attempt right now. */
        | "attempt_in_progress"
        /** Stripe has no such PaymentIntent on the attempt's account. */
        | "intent_not_found"
        /** Stripe could not be read: nothing was written. */
        | "stripe_unavailable";
    }
  /** Louez's own lookup found the attempt's PaymentIntent: it was recorded instead. */
  | {
      readonly ok: false;
      readonly error: "found_at_stripe";
      readonly paymentIntentId: string;
      readonly outcome: Exclude<HoldOutcome, "stale">;
    }
  /** The named PaymentIntent is not the attempt's: nothing was written. */
  | {
      readonly ok: false;
      readonly error: "intent_mismatch";
      readonly mismatches: readonly PastedIntentMismatch[];
    };

type ClaimedForResolution = {
  readonly id: string;
  readonly accountId: string;
  readonly paymentIntentId: string | null;
  readonly amount: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentMethodId: string;
  readonly customerId: string | null;
};

/**
 * Claims the reservation's pending attempt for the store's resolution, as a request
 * claims it: no request asks Stripe about it meanwhile.
 */
async function claimForResolution(
  database: Database,
  input: { readonly reservationId: string; readonly storeId: string },
): Promise<ClaimedForResolution | Extract<AttemptResolutionResult, { ok: false }>> {
  return database.transaction(async (tx) => {
    const [reservation] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)))
      .for("update");
    if (!reservation) return { ok: false, error: "reservation_not_found" } as const;
    const [pending] = await tx
      .select({
        id: payments.id,
        paymentIntentId: payments.stripePaymentIntentId,
        amount: payments.amount,
        amountMinor: payments.grossMinor,
        currency: payments.currency,
        paymentMethodId: payments.stripePaymentMethodId,
        accountId: payments.stripeAccountId,
        customerId: payments.stripeCustomerId,
        claimed: sql<number | null>`${payments.claimedUntil} > NOW()`,
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
    if (!pending) return { ok: false, error: "no_unconfirmed_attempt" } as const;
    if (Number(pending.claimed) === 1) return { ok: false, error: "attempt_in_progress" } as const;
    const { amountMinor, currency, paymentMethodId, accountId } = pending;
    // What an attempt is written with (claimAttempt): a row without it is no attempt.
    if (amountMinor === null || !currency || !paymentMethodId || !accountId) {
      return { ok: false, error: "no_unconfirmed_attempt" } as const;
    }
    await tx
      .update(payments)
      .set({
        claimedUntil: sql`NOW() + INTERVAL ${sql.raw(String(DEPOSIT_HOLD_CLAIM_SECONDS))} SECOND`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(payments.id, pending.id));
    return { ...pending, amountMinor, currency, paymentMethodId, accountId };
  });
}

/**
 * The store resolves an attempt Stripe has not confirmed, which nothing else may
 * settle: its customer cannot be listed, it has more PaymentIntents than a lookup
 * reads, its request never reached Stripe. Without it the reservation could take no
 * hold again.
 *
 * - `nothing_at_stripe`: the store found no authorization in its Stripe dashboard.
 *   Louez looks the attempt up first when it can: a PaymentIntent found is recorded,
 *   and the declaration refused (`found_at_stripe`). A lookup that cannot conclude, or
 *   cannot be made, leaves the store's word: the attempt is closed, its row kept
 *   `failed` with who closed it, and a new hold may be asked for. Were Stripe to hold
 *   it after all, its PaymentIntent is still recorded on that row when it shows up, and
 *   released when the reservation holds another.
 * - `payment_intent`: the store names the PaymentIntent. It is read on the attempt's
 *   account and compared with the attempt (`pastedIntentMismatches`); any difference
 *   refuses it, and nothing is written. Else it is recorded as Stripe has it.
 */
export async function resolveUnconfirmedAttempt(
  input: {
    readonly reservationId: string;
    readonly storeId: string;
    readonly actorUserId: string;
    readonly resolution: AttemptResolution;
  },
  deps: DepositHoldDeps,
): Promise<AttemptResolutionResult> {
  const { database, stripe } = deps;
  const attempt = await claimForResolution(database, input);
  if ("ok" in attempt) return attempt;

  const settle = async (intent: DepositIntent) => {
    const symbol = getCurrencySymbol(attempt.currency);
    const settled = await settleDepositIntent(database, {
      reservationId: input.reservationId,
      storeId: input.storeId,
      accountId: attempt.accountId,
      intent,
      actorUserId: input.actorUserId,
      descriptions: {
        deposit_authorized: `Empreinte de ${attempt.amount}${symbol} retrouvée chez Stripe (${intent.paymentIntentId})`,
      },
    });
    if (settled.status !== "settled") return null;
    deps.dispatchEffects(settled.effectIds);
    return settled.outcome === "stale" ? "pending" : settled.outcome;
  };

  try {
    if (input.resolution.kind === "nothing_at_stripe") {
      let found: DepositIntent | null = null;
      try {
        if (attempt.paymentIntentId) {
          found = await stripe.readIntent(attempt.accountId, attempt.paymentIntentId);
        } else {
          const lookup = await findAttemptIntent(stripe, attempt);
          if (lookup.kind === "found") found = lookup.intent;
        }
      } catch (error) {
        // A lookup that cannot be made leaves the store's word, which it rests on.
        log.warn(
          "deposit-hold",
          `attempt ${attempt.id} of reservation ${input.reservationId} could not be looked up before the store closed it: ${describeError(error)}`,
        );
      }
      if (found) {
        const outcome = await settle(found);
        if (outcome === null) return { ok: false, error: "no_unconfirmed_attempt" };
        return {
          ok: false,
          error: "found_at_stripe",
          paymentIntentId: found.paymentIntentId,
          outcome,
        };
      }
      const closed = await closeAbsentAttempt(database, {
        reservationId: input.reservationId,
        storeId: input.storeId,
        attemptId: attempt.id,
        closure: { kind: "declared_by_store" },
        actorUserId: input.actorUserId,
      });
      return closed
        ? { ok: true, outcome: "closed", paymentIntentId: null }
        : { ok: false, error: "no_unconfirmed_attempt" };
    }

    const { paymentIntentId } = input.resolution;
    let intent: DepositIntent | null;
    try {
      intent = await stripe.findIntent(attempt.accountId, paymentIntentId);
    } catch (error) {
      log.error(
        "deposit-hold",
        `${paymentIntentId}, named for attempt ${attempt.id} of reservation ${input.reservationId}, could not be read: ${describeError(error)}`,
      );
      return { ok: false, error: "stripe_unavailable" };
    }
    if (!intent) return { ok: false, error: "intent_not_found" };

    if (attempt.paymentIntentId !== paymentIntentId) {
      const holds = await readHoldRows(database, input.reservationId);
      const mismatches = attempt.paymentIntentId
        ? (["attempt"] as const)
        : pastedIntentMismatches({
            reservationId: input.reservationId,
            attempt,
            intent,
            holds: holds.filter((hold) => hold.id !== attempt.id),
          });
      if (mismatches.length > 0) return { ok: false, error: "intent_mismatch", mismatches };
    }
    // Its metadata, when it has none, is the attempt's: every other fact was compared,
    // and the writer compares them again under the reservation's lock.
    const outcome = await settle({
      ...intent,
      reservationId: intent.reservationId ?? input.reservationId,
      attemptId: intent.attemptId ?? attempt.id,
    });
    if (outcome === null) return { ok: false, error: "no_unconfirmed_attempt" };
    return { ok: true, outcome, paymentIntentId };
  } finally {
    // An attempt still pending is given back, so the next request asks Stripe at once.
    await releaseClaim(database, attempt);
  }
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

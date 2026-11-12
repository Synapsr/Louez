import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type Database,
  type Transaction,
  customers,
  markReservationIds,
  payments,
  reservations,
} from "@louez/db";
import type { StoreSettings } from "@louez/types";
import { getCurrencySymbol } from "@louez/utils";

import { log } from "@/lib/evlog";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { fromStripeCents, toStripeCents } from "@/lib/stripe";

import {
  type DepositAuthorizationAnswer,
  type DepositHoldStripe,
  STRIPE_CALL_MAX_SECONDS,
  depositHoldIdempotencyKey,
  findAttemptIntent,
} from "./deposit-hold-stripe";
import {
  type AttemptClaim,
  type AttemptClosure,
  type UnmatchedIntent,
  closeAbsentAttempt,
  holdsClaim,
  lockReservationRow,
  readUnmatchedIntents,
  recordUnmatchedIntent,
  settleClaimedIntent,
  settleDepositIntent,
} from "./deposit-hold-writes";
import {
  type AttemptFact,
  type DepositIntent,
  type HoldOutcome,
  type IntentRefusal,
  intentHoldsNothing,
  intentStateOf,
  unmatchedAttemptFacts,
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
// idempotency key and it travels, with the reservation's id, in the PaymentIntent's
// metadata. The row keeps the connected account it was sent to: every later call about
// it goes to that account.
//
// A claim has an owner. The request that claims the attempt writes a random token of
// its own in the row's `claim_token`, and a lease in `claimed_until`, on the
// database's clock (`AttemptClaim`); another request may take the attempt over only
// once the lease has run out, and writes its own token. Claiming, renewing, giving back
// and every check that a request still holds its claim lock the reservation's row
// first, then the attempt's, as every writer of a hold row does: nothing is decided
// about a claim under the attempt's lock alone. The request renews the lease before
// each Stripe call, for one call at its longest. A renewal or a check that finds
// another token, or none (the attempt was taken over, given back, or settled by the
// webhook, which clears the token), has lost the claim. A request that lost it writes
// nothing of what it read from Stripe, calls Stripe no more, and answers from the
// attempt's row: in progress while the row names no PaymentIntent, else what was
// recorded there by whoever settled it. A request that learned nothing certain reads
// the row too, under the reservation's lock, as it gives the attempt back: the webhook
// may have recorded it meanwhile, and its answer is then what was recorded.
//
// An attempt whose outcome is not known is not replaced while Stripe may still answer
// for it. It stays `pending`, is asked again with the same key, and is settled by a
// lookup or by the webhook, until Stripe shows its PaymentIntent, refuses the
// request, or a complete listing of its customer's PaymentIntents, made more than 24
// hours after its last request, holds none. Then it is closed: its row is kept,
// `failed`, and a new attempt may be asked for. Stripe does not promise to have
// reconciled a request it answered 500 to within 24 hours, so a closed attempt still
// reconciles: its PaymentIntent, when Stripe's event about it arrives and it matches
// the attempt, is recorded on its row, as the reservation's hold when it has none, or
// as a release owed (the outbox releases it) when it has another. No background lookup
// reads a closed attempt again: that rests on the event's delivery. A wrong verdict of
// absence thus costs at most, until that event arrives, a hold Louez does not know of
// yet.
//
// Found is never absent. A PaymentIntent Louez finds for the attempt (by its id, or by
// the attempt's id in its metadata) that the writer refuses, because its amount,
// currency, card, customer, capture method or reservation are not the attempt's (it was
// altered at Stripe), never closes or replaces the attempt while Stripe may hold funds
// on it: the attempt stays pending, an activity line records it for that attempt
// (`recordUnmatchedIntent`), and the store is told to cancel it in Stripe
// (`errors.depositAttempt.needsStripe`). That line blocks every closing of the attempt
// (`closeAbsentAttempt`), whatever a later lookup says or fails to say: the closing
// is made only once that PaymentIntent, read again by its id on the attempt's account
// (`readUnmatchedAgain`), holds nothing (`intentHoldsNothing`). A captured one never
// holds nothing: Louez does not record money captured on a PaymentIntent it refused,
// and the attempt stays open.
//
// An attempt nothing can settle (its customer cannot be listed, it has more
// PaymentIntents than a lookup reads, its request never reached Stripe) is the
// store's to close (`resolveUnconfirmedAttempt`). Louez looks the attempt up first,
// when it can, and records the PaymentIntent it finds when it matches the attempt;
// else the attempt is closed on the store's word. An authorization the store sees at
// Stripe that Louez has not recorded for the attempt is the store's to cancel in
// Stripe.
//
// What is guaranteed, and what is not:
// - One attempt makes at most one PaymentIntent (its key), and every PaymentIntent
//   Stripe makes of it that matches it is recorded on its row once Louez reads it: by
//   the request, a lookup, the store's closing, or, for a closed attempt, Stripe's
//   event alone. One that does not match keeps the attempt open while it may hold
//   funds, as above.
// - Not closed here, and each starts with a PaymentIntent altered by hand in the
//   store's Stripe account (its amount, card or metadata changed, or confirmed again or
//   captured there). One Louez had not found when its attempt was closed, or one that
//   held nothing then and was confirmed again since, is refused when its event
//   arrives, and only the logs say so. One captured there keeps its attempt open, and
//   Louez does not record its money: the store records it by hand.
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
// - Not closed here: deleting an account deletes its stores' payment rows and outbox
//   rows, and with them any release Louez still owed and the row a late event needs.
// - Migration 0100 must be applied before this code serves requests: the app runs
//   migrations at startup, and this code against the old schema fails its payment
//   reads.
// - Where a PaymentIntent read from Stripe is checked: its reservation (metadata) and
//   its capture method on every write (`bindDepositIntent`). On a row that already
//   names it, the account only: the id is Stripe's own and the row was written from
//   that PaymentIntent read on that account, while its amount, currency and card are
//   not compared, since rows written before this code may hold the column's default
//   currency, and refusing the capture or the release of a recorded hold would leave
//   money unrecorded. On an attempt it answers, the account, the amount, the
//   currency, the card and that it has a customer.

/**
 * How long a claim on an attempt lasts: one Stripe call at its longest
 * (deposit-hold-stripe.ts) and the writes that follow it. The request that holds it
 * renews it before each Stripe call (`underClaim`), so a lookup of any number of pages
 * stays claimed; a request that ends gives it back at once; one whose process died
 * keeps it until then. Counted on the database's clock.
 */
export const DEPOSIT_HOLD_CLAIM_SECONDS = STRIPE_CALL_MAX_SECONDS + 30;

const claimLease = () =>
  sql`NOW() + INTERVAL ${sql.raw(String(DEPOSIT_HOLD_CLAIM_SECONDS))} SECOND`;

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
  | "errors.stripe.authorizationFailed"
  /**
   * Louez found the attempt's PaymentIntent at Stripe, but it does not match the
   * attempt, and Stripe may hold funds on it: nothing was recorded, the attempt stays,
   * and no other hold is asked for. The store cancels it in Stripe, then closes the
   * request.
   */
  | "errors.depositAttempt.needsStripe";

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
  /** This request's claim on it. */
  readonly claim: AttemptClaim;
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

/** A request lost its claim: another request, or the webhook, settles the attempt now. */
class AttemptClaimLost extends Error {
  constructor(attemptId: string) {
    super(`The claim on attempt ${attemptId} is not this request's any more.`);
  }
}

/** The values that claim an attempt for a request, under a token of its own. */
const newClaim = (attemptId: string, reservationId: string) => {
  const claim: AttemptClaim = { attemptId, reservationId, token: nanoid() };
  return { claim, columns: { claimToken: claim.token, claimedUntil: claimLease() } };
};

/**
 * Renews the claim for one more Stripe call, while the request still holds it: under
 * the reservation's row lock, then the attempt's, the attempt is pending under this
 * request's token (`holdsClaim`). A token of another request, or none, means the claim
 * was taken over, given back, or settled by the webhook: it throws `AttemptClaimLost`,
 * before Stripe is called. Only `claimed_until` moves.
 */
async function renewClaim(database: Database, claim: AttemptClaim): Promise<void> {
  const held = await database.transaction(async (tx) => {
    if (!(await lockReservationRow(tx, claim.reservationId))) return false;
    if (!(await holdsClaim(tx, claim))) return false;
    await tx
      .update(payments)
      .set({ claimedUntil: claimLease() })
      .where(and(eq(payments.id, claim.attemptId), eq(payments.claimToken, claim.token)));
    return true;
  });
  if (!held) throw new AttemptClaimLost(claim.attemptId);
}

/**
 * The Stripe port as a claimed request uses it: each call renews the claim first, so
 * the claim lasts as long as the request's calls do, and a request that lost it calls
 * Stripe no more.
 */
function underClaim(
  stripe: DepositHoldStripe,
  database: Database,
  claim: AttemptClaim,
): DepositHoldStripe {
  const renewed =
    <Args extends unknown[], Result>(call: (...args: Args) => Promise<Result>) =>
    async (...args: Args) => {
      await renewClaim(database, claim);
      return call(...args);
    };
  return {
    authorize: renewed(stripe.authorize),
    readIntent: renewed(stripe.readIntent),
    cardCustomer: renewed(stripe.cardCustomer),
    listCustomerIntents: renewed(stripe.listCustomerIntents),
    capture: renewed(stripe.capture),
    release: renewed(stripe.release),
  };
}

/**
 * Gives the attempt back, so the next request asks Stripe about it at once: only the
 * claim this request holds, never one another request took over since. Under the
 * reservation's row lock, then the attempt's.
 */
async function releaseClaim(database: Database, claim: AttemptClaim): Promise<void> {
  await database.transaction(async (tx) => {
    await lockReservationRow(tx, claim.reservationId);
    await tx
      .update(payments)
      .set({ claimedUntil: null, claimToken: null })
      .where(and(eq(payments.id, claim.attemptId), eq(payments.claimToken, claim.token)));
  });
}

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
      const { claim, columns } = newClaim(pending.id, input.reservationId);
      await tx
        .update(payments)
        .set({
          ...columns,
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
        claim,
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
    const id = nanoid();
    const { claim, columns } = newClaim(id, input.reservationId);
    const attempt = {
      ...reference,
      id,
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
      ...columns,
      providerRequestedAt: sql`NOW()`,
      createdAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    });
    await markReservationIds(tx, [input.reservationId]);
    return { ...attempt, claim };
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
      if (error instanceof AttemptClaimLost) throw error;
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

/**
 * What the attempt's row records now, for a request that lost its claim. It wrote
 * nothing, and nothing it read from Stripe is written: the attempt is another
 * request's to settle, or the webhook settled it from its own read of Stripe. Null
 * while the row records no settled PaymentIntent: another request is on it.
 */
async function recordedAfterLoss(
  database: Database | Transaction,
  attemptId: string,
): Promise<{
  readonly paymentIntentId: string;
  readonly outcome: Exclude<HoldOutcome, "pending" | "stale">;
} | null> {
  const [row] = await database
    .select({
      status: payments.status,
      paymentIntentId: payments.stripePaymentIntentId,
      releaseOwedAt: payments.releaseOwedAt,
    })
    .from(payments)
    .where(eq(payments.id, attemptId));
  const paymentIntentId = row?.paymentIntentId;
  if (!paymentIntentId) return null;
  switch (row.status) {
    // A second authorization always has its release owed: else it is the reservation's hold.
    case "authorized":
      return { paymentIntentId, outcome: row.releaseOwedAt === null ? "authorized" : "superseded" };
    case "completed":
      return { paymentIntentId, outcome: "captured" };
    case "cancelled":
      return { paymentIntentId, outcome: "released" };
    case "failed":
      return { paymentIntentId, outcome: "failed" };
    default:
      return null;
  }
}

/**
 * Gives the attempt back, as `releaseClaim` does, and reads its row under the same
 * lock: what was recorded of it meanwhile (`recordedAfterLoss`), by the webhook
 * whose write cleared the claim, or null while it is still pending.
 */
async function giveBackAndRead(
  database: Database,
  claim: AttemptClaim,
): Promise<Awaited<ReturnType<typeof recordedAfterLoss>>> {
  return database.transaction(async (tx) => {
    await lockReservationRow(tx, claim.reservationId);
    await tx
      .update(payments)
      .set({ claimedUntil: null, claimToken: null })
      .where(and(eq(payments.id, claim.attemptId), eq(payments.claimToken, claim.token)));
    return recordedAfterLoss(tx, claim.attemptId);
  });
}

/** What a request of the store that lost its claim answers: see `recordedAfterLoss`. */
async function answerAfterLoss(database: Database, attempt: Attempt): Promise<DepositHoldResult> {
  const recorded = await recordedAfterLoss(database, attempt.id);
  return recorded
    ? answerRecorded(recorded, attempt)
    : refusal("errors.stripe.authorizationInProgress");
}

/** What a request of the store answers from what the attempt's row records. */
function answerRecorded(
  recorded: NonNullable<Awaited<ReturnType<typeof recordedAfterLoss>>>,
  attempt: Attempt,
): DepositHoldResult {
  switch (recorded.outcome) {
    case "authorized":
      return {
        ok: true,
        paymentIntentId: recorded.paymentIntentId,
        amount: Number(attempt.amount),
        currency: attempt.currency,
      };
    case "superseded":
    case "captured":
      return refusal("errors.stripe.invalidDepositStatus");
    case "released":
    case "failed":
      return refusal("errors.stripe.authorizationFailed");
  }
}

/** The facts of a refused PaymentIntent that are not the attempt's, for a `facts_mismatch`. */
const unmatchedFactsOf = (
  reason: IntentRefusal,
  attempt: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly paymentMethodId: string;
  },
  intent: DepositIntent,
): AttemptFact[] => (reason === "facts_mismatch" ? unmatchedAttemptFacts(attempt, intent) : []);

/**
 * What the attempt's closing needs (`closeAbsentAttempt`): each PaymentIntent found for
 * it and refused (`readUnmatchedIntents`), read again by its id on the account the
 * attempt was sent to. Outside any transaction, under the claim (`stripe` is
 * `underClaim`'s). A read that fails proves nothing: it is left out, and the closing is
 * then refused.
 */
async function readUnmatchedAgain(
  database: Database,
  stripe: DepositHoldStripe,
  attempt: { readonly id: string; readonly accountId: string },
  reservationId: string,
): Promise<DepositIntent[]> {
  const unmatched = await readUnmatchedIntents(database, { reservationId, attemptId: attempt.id });
  const reads: DepositIntent[] = [];
  for (const { paymentIntentId } of unmatched) {
    try {
      reads.push(await stripe.readIntent(attempt.accountId, paymentIntentId));
    } catch (error) {
      if (error instanceof AttemptClaimLost) throw error;
      log.warn(
        "deposit-hold",
        `${paymentIntentId}, found for attempt ${attempt.id} of reservation ${reservationId} and refused, could not be read again: ${describeError(error)}`,
      );
    }
  }
  return reads;
}

/** Logs a closing refused because a PaymentIntent found for the attempt may hold funds. */
const logUnmatchedBlocks = (attemptId: string, reservationId: string, found: UnmatchedIntent) =>
  log.error(
    "deposit-hold",
    `attempt ${attemptId} of reservation ${reservationId} is not closed: ${found.paymentIntentId}, found for it and refused, may hold funds (${found.status})`,
  );

async function runAttempt(
  input: DepositHoldInput,
  deps: DepositHoldDeps,
): Promise<DepositHoldResult | "start_over"> {
  const { database } = deps;

  const attempt = await claimAttempt(input, database);
  if ("ok" in attempt) return attempt;
  const { claim } = attempt;
  const stripe = underClaim(deps.stripe, database, claim);

  const unconfirmed = async () => {
    // The attempt stays, and its key with it, unless the webhook recorded it while
    // this request was asking: then its row says what Stripe holds.
    const recorded = await giveBackAndRead(database, claim);
    return recorded
      ? answerRecorded(recorded, attempt)
      : refusal("errors.stripe.authorizationUnconfirmed");
  };
  const lost = () => answerAfterLoss(database, attempt);

  try {
    const verdict = await askStripe(attempt, input, stripe);
    if (verdict.kind === "unknown") return await unconfirmed();

    if (verdict.kind === "absent") {
      const closed = await closeAbsentAttempt(database, {
        reservationId: input.reservationId,
        storeId: input.storeId,
        claim,
        closure:
          verdict.refusal === null
            ? { kind: "not_found" }
            : { kind: "refused", message: verdict.refusal },
        unmatchedReads: await readUnmatchedAgain(database, stripe, attempt, input.reservationId),
        actorUserId: input.actorUserId,
      });
      if (closed === "claim_lost") return await lost();
      if (closed === "settled_meanwhile") return await unconfirmed();
      if (typeof closed === "object") {
        // Found once, so not absent: nothing closes it while it may hold funds.
        logUnmatchedBlocks(attempt.id, input.reservationId, closed);
        await releaseClaim(database, claim);
        return refusal("errors.depositAttempt.needsStripe");
      }
      return verdict.refusal === null ? "start_over" : refusal("errors.stripe.authorizationFailed");
    }

    const { intent } = verdict;
    const symbol = getCurrencySymbol(attempt.currency);
    const failure = verdict.refusal
      ? `Échec de l'empreinte: ${verdict.refusal}`
      : `Empreinte non capturable (statut Stripe: ${intent.status})`;
    const settled = await settleClaimedIntent(database, {
      reservationId: input.reservationId,
      storeId: input.storeId,
      accountId: attempt.accountId,
      intent,
      claim,
      actorUserId: input.actorUserId,
      failure,
      descriptions: {
        deposit_authorized: `Empreinte de ${attempt.amount}${symbol} créée`,
        deposit_failed: failure,
      },
    });
    if (settled.status === "reservation_not_found") return refusal("errors.reservationNotFound");
    if (settled.status === "claim_lost") return await lost();
    if (settled.status === "refused") {
      log.error(
        "deposit-hold",
        `${intent.paymentIntentId} is not written on attempt ${attempt.id} of reservation ${input.reservationId}: ${settled.reason}`,
      );
      // Found, so not absent: the attempt is never closed or replaced here. While
      // Stripe may hold funds on it, the store settles it at Stripe first.
      if (intentHoldsNothing(intent)) return await unconfirmed();
      const traced = await recordUnmatchedIntent(database, {
        reservationId: input.reservationId,
        storeId: input.storeId,
        claim,
        intent,
        reason: settled.reason,
        unmatchedFacts: unmatchedFactsOf(settled.reason, attempt, intent),
        actorUserId: input.actorUserId,
      });
      if (traced === "claim_lost") return await lost();
      await releaseClaim(database, claim);
      return refusal("errors.depositAttempt.needsStripe");
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
    if (error instanceof AttemptClaimLost) return await lost();
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

export type AttemptResolutionResult =
  /**
   * Louez found nothing at Stripe for the attempt, or a PaymentIntent that holds
   * nothing: the attempt is closed, and a new hold may be asked for.
   */
  | { readonly ok: true; readonly outcome: "closed"; readonly paymentIntentId: null }
  /** Louez's own lookup found the attempt's PaymentIntent: it was recorded as Stripe has it. */
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
        | "attempt_in_progress";
    }
  /**
   * Louez found the attempt's PaymentIntent, now or before, which is not the attempt's
   * to record (its facts or its reservation are not the attempt's), and Stripe may
   * hold funds on it, or it could not be read again: the attempt is not closed, and no
   * other hold is asked for, until it is read cancelled.
   */
  | {
      readonly ok: false;
      readonly error: "attempt_needs_stripe";
      readonly paymentIntentId: string;
      /** Its status at Stripe. */
      readonly status: string;
      readonly reason: IntentRefusal;
      /** For a `facts_mismatch`, the facts that differ. */
      readonly unmatchedFacts: readonly AttemptFact[];
    };

type ClaimedForResolution = {
  readonly id: string;
  readonly claim: AttemptClaim;
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
    const { claim, columns } = newClaim(pending.id, input.reservationId);
    await tx
      .update(payments)
      .set({ ...columns, updatedAt: sql`NOW()` })
      .where(eq(payments.id, pending.id));
    return {
      id: pending.id,
      claim,
      accountId,
      paymentIntentId: pending.paymentIntentId,
      amount: pending.amount,
      amountMinor,
      currency,
      paymentMethodId,
      customerId: pending.customerId,
    };
  });
}

/**
 * The store closes an attempt Stripe has not confirmed, which nothing else may settle:
 * its customer cannot be listed, it has more PaymentIntents than a lookup reads, its
 * request never reached Stripe. Without it the reservation could take no hold again.
 *
 * Louez looks the attempt up first, when it can: by the PaymentIntent it knows, or
 * among the PaymentIntents of the customer the attempt was sent with, by the attempt's
 * id in their metadata. A PaymentIntent found is recorded as Stripe has it, and the
 * answer says what it was recorded as. One found that the writer refuses (its amount,
 * currency, card, capture method or reservation are not the attempt's: altered at
 * Stripe) is never taken for absent: while Stripe may hold funds on it, the attempt
 * stays pending, an activity line records it, and the answer is `attempt_needs_stripe`,
 * for the store to cancel it in Stripe and close the request again. A lookup that finds
 * nothing, cannot conclude or cannot be made leaves the store's word: the attempt is
 * closed, its row kept `failed` with who closed it, and a new hold may be asked for;
 * but not while a PaymentIntent found for it before may hold funds: each is read again
 * by its id first, and the closing is made only once all of them hold nothing
 * (`closeAbsentAttempt`), else the answer is `attempt_needs_stripe` again.
 * Nothing is cancelled at Stripe. Were Stripe to hold it after all, its PaymentIntent
 * is recorded on that row when Stripe's event about it arrives, if it matches the
 * attempt: as the reservation's deposit when it has none, with its release owed when
 * another hold secures it.
 *
 * The resolution holds the attempt's claim as a request does: it renews it before each
 * Stripe call, and writes only while it holds it. One that lost it writes nothing, and
 * answers `attempt_in_progress` while another request is on the attempt, or what the
 * webhook recorded of it.
 */
export async function resolveUnconfirmedAttempt(
  input: {
    readonly reservationId: string;
    readonly storeId: string;
    readonly actorUserId: string;
  },
  deps: DepositHoldDeps,
): Promise<AttemptResolutionResult> {
  const { database } = deps;
  const attempt = await claimForResolution(database, input);
  if ("ok" in attempt) return attempt;
  const { claim } = attempt;
  const stripe = underClaim(deps.stripe, database, claim);
  // Lost to another request: in progress. Lost to the webhook: what it recorded.
  const lost = async (): Promise<AttemptResolutionResult> => {
    const recorded = await recordedAfterLoss(database, attempt.id);
    return recorded ? { ok: true, ...recorded } : { ok: false, error: "attempt_in_progress" };
  };

  try {
    let found: DepositIntent | null = null;
    try {
      if (attempt.paymentIntentId) {
        found = await stripe.readIntent(attempt.accountId, attempt.paymentIntentId);
      } else {
        const lookup = await findAttemptIntent(stripe, attempt);
        if (lookup.kind === "found") found = lookup.intent;
      }
    } catch (error) {
      if (error instanceof AttemptClaimLost) throw error;
      // A lookup that cannot be made leaves the store's word, which it rests on.
      log.warn(
        "deposit-hold",
        `attempt ${attempt.id} of reservation ${input.reservationId} could not be looked up before the store closed it: ${describeError(error)}`,
      );
    }

    let closure: AttemptClosure = { kind: "declared_by_store" };
    if (found) {
      const symbol = getCurrencySymbol(attempt.currency);
      const settled = await settleClaimedIntent(database, {
        reservationId: input.reservationId,
        storeId: input.storeId,
        accountId: attempt.accountId,
        intent: found,
        claim,
        actorUserId: input.actorUserId,
        descriptions: {
          deposit_authorized: `Empreinte de ${attempt.amount}${symbol} retrouvée chez Stripe (${found.paymentIntentId})`,
        },
      });
      if (settled.status === "claim_lost") return await lost();
      if (settled.status === "reservation_not_found") {
        return { ok: false, error: "reservation_not_found" };
      }
      if (settled.status === "settled") {
        deps.dispatchEffects(settled.effectIds);
        return {
          ok: true,
          outcome: settled.outcome === "stale" ? "pending" : settled.outcome,
          paymentIntentId: found.paymentIntentId,
        };
      }
      // Not the attempt's to record, and found all the same: never absent.
      const { reason } = settled;
      log.error(
        "deposit-hold",
        `${found.paymentIntentId} is not written on attempt ${attempt.id} of reservation ${input.reservationId}: ${reason}`,
      );
      if (!intentHoldsNothing(found)) {
        // Stripe may hold funds on it: the attempt stays until the store settles it there.
        const unmatchedFacts = unmatchedFactsOf(reason, attempt, found);
        const traced = await recordUnmatchedIntent(database, {
          reservationId: input.reservationId,
          storeId: input.storeId,
          claim,
          intent: found,
          reason,
          unmatchedFacts,
          actorUserId: input.actorUserId,
        });
        if (traced === "claim_lost") return await lost();
        return {
          ok: false,
          error: "attempt_needs_stripe",
          paymentIntentId: found.paymentIntentId,
          status: found.status,
          reason,
          unmatchedFacts,
        };
      }
      // It holds nothing: what it differs in no longer matters.
      closure = {
        kind: "unmatched_empty",
        paymentIntentId: found.paymentIntentId,
        status: found.status,
        reason,
      };
    }

    const closed = await closeAbsentAttempt(database, {
      reservationId: input.reservationId,
      storeId: input.storeId,
      claim,
      closure,
      unmatchedReads: await readUnmatchedAgain(database, stripe, attempt, input.reservationId),
      actorUserId: input.actorUserId,
    });
    if (closed === "claim_lost") return await lost();
    if (typeof closed === "object") {
      logUnmatchedBlocks(attempt.id, input.reservationId, closed);
      return { ok: false, error: "attempt_needs_stripe", ...closed };
    }
    return closed === "closed"
      ? { ok: true, outcome: "closed", paymentIntentId: null }
      : { ok: false, error: "no_unconfirmed_attempt" };
  } catch (error) {
    if (error instanceof AttemptClaimLost) return await lost();
    throw error;
  } finally {
    // An attempt still pending under this claim is given back, so the next request
    // asks Stripe at once.
    await releaseClaim(database, claim);
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

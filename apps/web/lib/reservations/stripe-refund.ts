import { type SQL, and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type ApiEffectSenders,
  type EffectSendContext,
  effectRetryDelayMs,
  enqueueEffects,
} from "@louez/api/platform/effects";
import {
  type Database,
  type Transaction,
  apiEffects,
  db,
  isDuplicateKeyError,
  isPaymentReceiptSql,
  isStripeRefundPaymentSql,
  isTestReservation,
  paymentDisputes,
  paymentRefundOperations,
  payments,
  reservations,
  stores,
} from "@louez/db";

import { currencyMinorDigits } from "@louez/utils";

import { log } from "@/lib/evlog";
import { toStripeCents } from "@/lib/stripe";

import {
  type ProviderRefund,
  type ChargeSnapshot,
  REFUND_LOOKUP_MAX_PAGES,
  REFUND_REQUEST_TIMEOUT_MS,
  type RefundAnswer,
  type RefundCharge,
  type StripeRefundPort,
  laterRefundReport,
  lookUpOperationRefund,
  readChargeSnapshot,
  refundIdempotencyKey,
  stripeRefunds,
} from "./stripe-refund-stripe";
import {
  REFUND_TRANSACTION,
  lockRefundReservation,
  recordChargeRefunds,
  refundTypeOf,
} from "./stripe-refund-writes";

// A refund of an online payment is one durable operation (docs/domain
// reservation-invariants.md, M9). It is recorded before Stripe is called, reaches
// Stripe at most once whatever fails or is retried, and is recorded once whichever of
// its sender and the Connect webhook hears of it first.
//
// - Asked (`requestStripeRefund`): in the caller's transaction, under the reservation's
//   row lock, the payment is checked, what it can still give back is counted, and the
//   operation is written `requested` with its outbox row (`payment.refund`). Two
//   requests share one limit: an open operation (`requested` or `unresolved`) takes
//   its amount out of it, and a refund Stripe made, pending or not, its row's.
// - Sent (`sendRefundOperation`, the outbox's sender, run once inline after the commit,
//   then by the outbox): it claims the operation under a token of its own and sends
//   `refunds.create` with the key `refund:<operation id>` and the id in the refund's
//   metadata, on the account and charge the payment names. While the operation's first
//   request is under 23 hours old it may send again: Stripe answers for the first
//   request. Older, it never sends again: it is `unresolved`, and only Stripe's account
//   of the charge settles it. The identity of a retry is the operation, never its
//   amount: two refunds of one amount are two operations.
// - Pending: Stripe made the refund and states it pending (or awaiting an action). The
//   writer records it as Stripe counts it (its row, the netting, its credit note) and
//   states the operation `pending`: issued, not received yet. Only Stripe settles it,
//   through its refund events, a read of the refund, or the cron's lookup; nothing
//   sends it again.
// - Settled: `succeeded` by the one writer of a charge's refunds (stripe-refund-writes.ts),
//   which the webhook's `charge.refunded` also runs, once Stripe states its refund
//   succeeded. `failed` when Stripe refused its
//   first request, when Stripe reports its refund failed or canceled, or on Stripe's
//   own account of the charge: a fresh read of the charge and all its refunds that
//   names none of the operation and adds up to what the charge says was refunded,
//   after a request sent again was refused, or more than 24 hours after the last
//   request. Absence alone (a listing incomplete, unreadable, or that does not add up)
//   closes nothing. A timeout, a 500, a rate limit, a 500 replayed for the key: the
//   outcome is unknown, the sender throws, and the outbox asks again later.
// - Abandoned: an open operation whose outbox row was abandoned or pruned gets a new
//   one from the cron (`requeueStaleRefundOperations`). One still open a day after it
//   was asked is shown in the store's inbox (`refund_unconfirmed`); no age closes it.

/**
 * The states of an operation whose refund Stripe may not have made: it may still be
 * sent, or looked up. Each holds back its amount. A `pending` one has its refund row,
 * which counts it.
 */
export const OPEN_REFUND_STATUSES = ["requested", "unresolved"] as const;

const isOpenRefundStatus = (status: string): boolean =>
  (OPEN_REFUND_STATUSES as readonly string[]).includes(status);

/**
 * The states of an operation Stripe has not settled: the open ones, and `pending`, a
 * refund Stripe made and still holds. A lookup may settle each.
 */
export const UNSETTLED_REFUND_STATUSES = [...OPEN_REFUND_STATUSES, "pending"] as const;

const isUnsettledRefundStatus = (status: string): boolean =>
  (UNSETTLED_REFUND_STATUSES as readonly string[]).includes(status);

/**
 * How long a sender holds an operation: every Stripe call one run makes at its longest
 * (the request, a lookup, the charge and its refunds read again), each bounded by its
 * timeout and sent once, and the writes that follow. Counted on the database's clock.
 */
export const REFUND_CLAIM_SECONDS =
  (2 + 2 * REFUND_LOOKUP_MAX_PAGES) * (REFUND_REQUEST_TIMEOUT_MS / 1000) + 60;

/**
 * Stripe may forget an idempotency key once it is 24 hours old, and would then refund
 * again. An operation created longer ago than this that was sent once is looked up,
 * never sent again. One never sent may still be: Stripe has never seen its key.
 */
const KEY_SENDABLE_HOURS = 23;

/**
 * How long after its last request a refund may still come of it. Before that, a
 * listing that shows none proves nothing.
 */
const KEY_WINDOW_HOURS = 24;

const hours = (count: number) => sql.raw(String(count));

/**
 * After an attempt that did not settle the operation, no other attempt (the outbox's,
 * the scheduled pass's, a read's) reaches Stripe for this long: a quarter of the
 * operation's age, at least 30 seconds (the rhythm the reference gives callers that
 * poll) and at most an hour. Repeated answers that tell nothing space out as the
 * operation ages; a caller reading it meanwhile gets its state as stored.
 */
export const REFUND_RETRY_MIN_SECONDS = 30;
export const REFUND_RETRY_MAX_SECONDS = 3_600;

/**
 * Room for one full attempt before the key may no longer be sent: the sender's claim
 * (every call of one run at its longest, `REFUND_CLAIM_SECONDS`) and the outbox's
 * shortest retry delay. The wait never ends inside it while the key may be sent.
 */
export const REFUND_RESEND_MARGIN_SECONDS = REFUND_CLAIM_SECONDS + effectRetryDelayMs(1) / 1000;

const retryWaitSeconds = sql`GREATEST(${REFUND_RETRY_MIN_SECONDS}, LEAST(${REFUND_RETRY_MAX_SECONDS}, TIMESTAMPDIFF(SECOND, ${paymentRefundOperations.createdAt}, NOW()) DIV 4))`;

/**
 * When the next attempt may reach Stripe. While the key may still be sent (under
 * `KEY_SENDABLE_HOURS` old), never later than the last moment that leaves one full
 * attempt (`REFUND_RESEND_MARGIN_SECONDS`) before that ends: at once when that moment
 * has passed. A lookup after it waits the whole wait.
 */
const retryNotBefore = sql`CASE
  WHEN ${paymentRefundOperations.createdAt} > NOW() - INTERVAL ${hours(KEY_SENDABLE_HOURS)} HOUR
  THEN LEAST(
    NOW() + INTERVAL ${retryWaitSeconds} SECOND,
    GREATEST(NOW(), ${paymentRefundOperations.createdAt} + INTERVAL ${hours(KEY_SENDABLE_HOURS)} HOUR - INTERVAL ${REFUND_RESEND_MARGIN_SECONDS} SECOND)
  )
  ELSE NOW() + INTERVAL ${retryWaitSeconds} SECOND
END`;

/** An open operation gets a new outbox row this long after its last one. */
const REFUND_REQUEUE_HOURS = 1;

/** The inline attempt after the commit: short, the outbox has the rest. */
export const INLINE_REFUND_SEND_TIMEOUT_MS = 15_000;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type RefundReason = "requested_by_customer" | "duplicate" | "fraudulent";

/** Who asked for a refund: a person signed in, or a key or an agent's credential. */
export type RefundRequester = {
  readonly userId: string | null;
  readonly credentialId: string | null;
};

export type RefundRequestInput = {
  readonly storeId: string;
  readonly paymentId: string;
  /** In the payment's own currency, minor units. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason?: RefundReason;
  readonly notes?: string | null;
  /** The approval a person gave for it; one approval gives one refund at most. */
  readonly approvalId?: string | null;
  readonly requestedBy: RefundRequester;
};

/** Why a refund request is refused, by a stable code. */
export type RefundRefusalReason =
  | { readonly code: "PAYMENT_NOT_FOUND" }
  | {
      readonly code: "PAYMENT_NOT_REFUNDABLE";
      /** A refund row, a deposit hold, money not taken online, or a payment that failed. */
      readonly reason: "refund_row" | "deposit_hold" | "not_online" | "failed" | "charge_changed";
    }
  /** Its money is not taken yet: pending, or no charge. */
  | { readonly code: "PAYMENT_NOT_SETTLED" }
  | { readonly code: "REFUND_AMOUNT_INVALID" }
  | {
      readonly code: "REFUND_EXCEEDS_REFUNDABLE";
      readonly paidMinor: number;
      readonly refundedMinor: number;
      readonly inFlightMinor: number;
      readonly refundableMinor: number;
      readonly currency: string;
    }
  /** A Stripe payment is refunded in its charge's currency, which this one is. */
  | { readonly code: "REFUND_CURRENCY_MISMATCH"; readonly currency: string }
  /** A three-decimal currency, which Louez's billing does not count. */
  | { readonly code: "REFUND_CURRENCY_NOT_SUPPORTED"; readonly currency: string }
  | { readonly code: "PAYMENT_DISPUTED" }
  /** The charge is recorded on payment rows of several reservations: refused, never guessed. */
  | { readonly code: "PAYMENT_CHARGE_SHARED"; readonly message: string }
  | { readonly code: "NO_STRIPE_ACCOUNT" }
  | { readonly code: "REFUND_APPROVAL_USED" };

/** A refused refund request: nothing was written. */
export type RefundRefusal = { readonly ok: false } & RefundRefusalReason;

const refused = (reason: RefundRefusalReason): RefundRefusal => ({ ok: false, ...reason });

/** The charge a refund comes off, as Stripe stated it before the reservation's lock. */
export type RefundableCharge = RefundCharge & {
  readonly paymentId: string;
  /** The payment's reservation: the first lock of the request. */
  readonly reservationId: string;
  readonly accountId: string;
};

type PaymentFacts = {
  readonly id: string;
  readonly reservationId: string;
  readonly storeId: string;
  readonly type: (typeof payments.$inferSelect)["type"];
  readonly method: (typeof payments.$inferSelect)["method"];
  readonly status: (typeof payments.$inferSelect)["status"];
  readonly chargeId: string | null;
  readonly accountId: string | null;
  readonly grossMinor: number | null;
  readonly refundOfPaymentId: string | null;
  readonly isStripeRefund: unknown;
};

const paymentFacts = (database: Database | Transaction, paymentId: string) =>
  database
    .select({
      id: payments.id,
      reservationId: payments.reservationId,
      storeId: reservations.storeId,
      type: payments.type,
      method: payments.method,
      status: payments.status,
      chargeId: payments.stripeChargeId,
      // For a row written before payments had one: the store's account of today.
      accountId: sql<
        string | null
      >`COALESCE(${payments.stripeAccountId}, ${stores.stripeAccountId})`,
      grossMinor: payments.grossMinor,
      refundOfPaymentId: payments.refundOfPaymentId,
      isStripeRefund: isStripeRefundPaymentSql(),
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(eq(payments.id, paymentId));

/**
 * What a payment's own row says about refunding it, before any figure: a refusal, or
 * the charge and the account the refund goes to.
 */
function checkPayment(
  payment: PaymentFacts | undefined,
  storeId: string,
):
  | RefundRefusal
  | { readonly chargeId: string; readonly accountId: string; readonly reservationId: string } {
  if (!payment || payment.storeId !== storeId) return refused({ code: "PAYMENT_NOT_FOUND" });
  if (payment.refundOfPaymentId !== null || Number(payment.isStripeRefund) === 1) {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "refund_row" });
  }
  if (payment.type === "deposit_return") {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "refund_row" });
  }
  // A hold took no money: its capture is the payment to refund.
  if (payment.type === "deposit_hold") {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "deposit_hold" });
  }
  if (payment.method !== "stripe") {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "not_online" });
  }
  if (payment.status === "failed" || payment.status === "cancelled") {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "failed" });
  }
  // `refunded` is settled money all given back: its ceiling says so.
  if (payment.status !== "completed" && payment.status !== "refunded") {
    return refused({ code: "PAYMENT_NOT_SETTLED" });
  }
  if (!payment.chargeId) return refused({ code: "PAYMENT_NOT_SETTLED" });
  if (!payment.accountId) return refused({ code: "NO_STRIPE_ACCOUNT" });
  return {
    chargeId: payment.chargeId,
    accountId: payment.accountId,
    reservationId: payment.reservationId,
  };
}

/**
 * Step one of a request, before any lock: the payment's charge as Stripe has it now,
 * on the account the payment names. Read outside any transaction; the request checks
 * it again under the reservation's lock. Throws when Stripe cannot be read: nothing
 * was written.
 */
export async function readChargeForRefund(
  deps: { readonly database: Database; readonly stripe: Pick<StripeRefundPort, "readCharge"> },
  input: Pick<RefundRequestInput, "storeId" | "paymentId">,
): Promise<RefundRefusal | { readonly ok: true; readonly charge: RefundableCharge }> {
  const [payment] = await paymentFacts(deps.database, input.paymentId);
  const checked = checkPayment(payment, input.storeId);
  if ("ok" in checked) return checked;
  // A test reservation's money was never taken online (lib/test-reservations).
  if (await isTestReservation(deps.database, checked.reservationId)) {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "not_online" });
  }
  const charge = await deps.stripe.readCharge(checked.accountId, checked.chargeId);
  return {
    ok: true,
    charge: {
      ...charge,
      paymentId: input.paymentId,
      reservationId: checked.reservationId,
      accountId: checked.accountId,
    },
  };
}

export type RequestedRefund = {
  readonly ok: true;
  readonly operationId: string;
  /** The outbox row that sends it: hand it to the inline attempt after the commit. */
  readonly effectIds: readonly string[];
};

/**
 * Step two: records the refund as an operation, in the caller's transaction. The
 * transaction is READ COMMITTED, as every writer of a refund's is (`REFUND_TRANSACTION`),
 * so what is read after a lock is what is committed. Locks, in order: the
 * reservation's row named by `charge` (the caller may hold it already), the open
 * operations of every payment row of the charge, those payment rows by id. A charge
 * recorded on rows of several reservations is refused (`PAYMENT_CHARGE_SHARED`).
 * Then:
 *
 * - the payment is refundable: this store's, a Stripe payment with a charge, settled,
 *   not a refund row, not a hold (its capture is), not disputed, on an account;
 * - the amount is whole minor units, more than zero, in the charge's currency;
 * - it fits under the charge's ceiling, whichever of its payment rows is asked: the
 *   smaller of what Stripe says the charge still holds (`charge`, read before the lock)
 *   and what Louez counts (the payment's gross, or the charge's captured amount for a
 *   row without one or a charge on several rows, less the Stripe refunds recorded for
 *   any of its rows, once per refund, pending or not), less the refunds given by hand
 *   against any of its rows and the operations still open on any of them. Stripe knows
 *   neither of those two; an open operation Stripe has already made comes off twice
 *   until it is recorded, which can refuse, never refund too much.
 *
 * Writes the operation `requested` and its outbox row. Sends nothing.
 */
export async function requestStripeRefund(
  tx: Transaction,
  input: RefundRequestInput & { readonly charge: RefundableCharge },
): Promise<RefundRefusal | RequestedRefund> {
  const checked = await checkStripeRefund(tx, input);
  if (!checked.ok) return checked;
  const operationId = nanoid();
  try {
    await tx.insert(paymentRefundOperations).values({
      id: operationId,
      storeId: input.storeId,
      reservationId: checked.reservationId,
      paymentId: input.paymentId,
      stripeAccountId: checked.accountId,
      stripeChargeId: checked.chargeId,
      amountMinor: input.amountMinor,
      currency: checked.currency,
      refundType: checked.refundType,
      reason: input.reason ?? "requested_by_customer",
      notes: input.notes?.trim() || null,
      approvalId: input.approvalId ?? null,
      requestedByUserId: input.requestedBy.userId,
      requestedByCredentialId: input.requestedBy.credentialId,
      status: "requested",
      createdAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    });
  } catch (error) {
    // The approval was used by a request that committed since the read above.
    if (input.approvalId && isDuplicateKeyError(error)) {
      return refused({ code: "REFUND_APPROVAL_USED" });
    }
    throw error;
  }
  const effectIds = await enqueueEffects(tx, input.storeId, [
    { type: "payment.refund", payload: { operationId } },
  ]);
  return { ok: true, operationId, effectIds };
}

/**
 * What a request is checked against, as read under its locks: the facts an approval of
 * it binds (the payment's status and gross, the charge's refunds that stand, the open
 * operations on it) and the ceiling.
 */
export type CheckedStripeRefund = {
  readonly ok: true;
  readonly reservationId: string;
  readonly accountId: string;
  readonly chargeId: string;
  readonly currency: string;
  readonly refundType: "rental" | "deposit_return";
  readonly paymentStatus: string;
  readonly grossMinor: number | null;
  /** The completed refunds of the charge's rows, by row id: Stripe's and those given by hand. */
  readonly refunds: readonly { readonly id: string; readonly amountMinor: number }[];
  /** The open operations on the charge's rows. */
  readonly openOperations: readonly { readonly id: string; readonly amountMinor: number }[];
  /** Every dispute ever opened on the payment, by id. */
  readonly disputes: readonly string[];
  readonly ceiling: {
    readonly paidMinor: number;
    readonly refundedMinor: number;
    readonly inFlightMinor: number;
    readonly refundableMinor: number;
  };
};

/**
 * Every check of `requestStripeRefund`, under the same locks, writing nothing: what a
 * caller that asks a person first shows and binds, before it records the operation.
 */
export async function checkStripeRefund(
  tx: Transaction,
  input: RefundRequestInput & { readonly charge: RefundableCharge },
): Promise<RefundRefusal | CheckedStripeRefund> {
  const { charge } = input;
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    return refused({ code: "REFUND_AMOUNT_INVALID" });
  }

  if (charge.paymentId !== input.paymentId) {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "charge_changed" });
  }
  const reservation = await lockRefundReservation(tx, charge.reservationId);
  if (!reservation || reservation.storeId !== input.storeId) {
    return refused({ code: "PAYMENT_NOT_FOUND" });
  }

  // Every payment row of the charge shares one ceiling: the money is the charge's.
  const siblings = await tx
    .select({ id: payments.id, reservationId: payments.reservationId })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(
      and(
        eq(payments.stripeChargeId, charge.chargeId),
        eq(payments.method, "stripe"),
        sql`${payments.type} <> 'deposit_hold'`,
        isPaymentReceiptSql(),
        sql`COALESCE(${payments.stripeAccountId}, ${stores.stripeAccountId}) = ${charge.accountId}`,
      ),
    )
    .orderBy(asc(payments.id));
  // A charge whose rows span reservations is refused: their locks would be taken across
  // reservations, in no order every other writer follows.
  if (siblings.some((row) => row.reservationId !== charge.reservationId)) {
    return refused({
      code: "PAYMENT_CHARGE_SHARED",
      message:
        "This Stripe charge is recorded on payments of several reservations, so Louez cannot tell how much of it each may give back. Refund it from the Stripe dashboard; Louez records the refund when Stripe reports it.",
    });
  }
  const chargePaymentIds = [...new Set([input.paymentId, ...siblings.map((row) => row.id)])].sort();
  const operations = await tx
    .select({
      id: paymentRefundOperations.id,
      amountMinor: paymentRefundOperations.amountMinor,
      status: paymentRefundOperations.status,
    })
    .from(paymentRefundOperations)
    .where(inArray(paymentRefundOperations.paymentId, chargePaymentIds))
    .orderBy(asc(paymentRefundOperations.id))
    .for("update");
  await tx
    .select({ id: payments.id })
    .from(payments)
    .where(inArray(payments.id, chargePaymentIds))
    .orderBy(asc(payments.id))
    .for("update");
  const [payment] = await paymentFacts(tx, input.paymentId);
  const checked = checkPayment(payment, input.storeId);
  if ("ok" in checked) return checked;
  if (!payment || checked.reservationId !== charge.reservationId) {
    return refused({ code: "PAYMENT_NOT_FOUND" });
  }
  if (checked.chargeId !== charge.chargeId || checked.accountId !== charge.accountId) {
    return refused({ code: "PAYMENT_NOT_REFUNDABLE", reason: "charge_changed" });
  }

  const currency = charge.currency.toUpperCase();
  if (input.currency.trim().toUpperCase() !== currency) {
    return refused({ code: "REFUND_CURRENCY_MISMATCH", currency });
  }
  // Louez and its billing count no three-decimal currency (`currencyMinorDigits`).
  if (currencyMinorDigits(currency) === null) {
    return refused({ code: "REFUND_CURRENCY_NOT_SUPPORTED", currency });
  }

  // Read committed, unlocked: the dispute webhook takes no lock of the reservation's, so
  // one may land between two reads of one transaction (an approval binds their ids).
  const disputes = await tx
    .select({ id: paymentDisputes.id, status: paymentDisputes.status })
    .from(paymentDisputes)
    .where(eq(paymentDisputes.paymentId, input.paymentId))
    .orderBy(asc(paymentDisputes.id));
  if (disputes.some((dispute) => dispute.status === "open")) {
    return refused({ code: "PAYMENT_DISPUTED" });
  }

  if (input.approvalId) {
    const [used] = await tx
      .select({ id: paymentRefundOperations.id })
      .from(paymentRefundOperations)
      .where(eq(paymentRefundOperations.approvalId, input.approvalId))
      .limit(1);
    if (used) return refused({ code: "REFUND_APPROVAL_USED" });
  }

  const ceiling = await refundCeiling(tx, {
    paymentIds: chargePaymentIds,
    reservationId: payment.reservationId,
    chargeId: checked.chargeId,
    // Several rows of one charge: the charge's own capture is what was paid.
    grossMinor: chargePaymentIds.length > 1 ? null : payment.grossMinor,
    charge,
    openMinor: operations
      .filter((operation) => isOpenRefundStatus(operation.status))
      .reduce((sum, operation) => sum + operation.amountMinor, 0),
  });
  const { rows: refunds, ...figures } = ceiling;
  if (input.amountMinor > figures.refundableMinor) {
    return refused({ code: "REFUND_EXCEEDS_REFUNDABLE", ...figures, currency });
  }
  return {
    ok: true,
    reservationId: payment.reservationId,
    accountId: checked.accountId,
    chargeId: checked.chargeId,
    currency,
    refundType: refundTypeOf(payment.type),
    paymentStatus: payment.status,
    grossMinor: payment.grossMinor,
    refunds,
    openOperations: operations
      .filter((operation) => isOpenRefundStatus(operation.status))
      .map(({ id, amountMinor }) => ({ id, amountMinor })),
    disputes: disputes.map((dispute) => dispute.id),
    ceiling: figures,
  };
}

/** What a payment can still give back, and the figures it comes from (minor units). */
async function refundCeiling(
  tx: Transaction,
  input: {
    /** Every payment row of the charge. */
    readonly paymentIds: readonly string[];
    readonly reservationId: string;
    readonly chargeId: string;
    readonly grossMinor: number | null;
    readonly charge: RefundCharge;
    readonly openMinor: number;
  },
): Promise<{
  readonly paidMinor: number;
  readonly refundedMinor: number;
  readonly inFlightMinor: number;
  readonly refundableMinor: number;
  /** Each completed refund counted, by its row's id. */
  readonly rows: readonly { readonly id: string; readonly amountMinor: number }[];
}> {
  const { charge } = input;
  const minorOf = (row: { readonly grossMinor: number | null; readonly amount: string }) =>
    row.grossMinor ?? toStripeCents(Number(row.amount), charge.currency);

  // The rows that give the charge's money back, whichever of its payment rows they
  // point at. A Stripe refund row points at the payment it refunds; one written before
  // that column carries the charge instead.
  // A refund id stamped on the payment itself (the oldest webhooks) is not counted
  // here: Stripe's figure holds it.
  const rows = await tx
    .select({
      id: payments.id,
      amount: payments.amount,
      grossMinor: payments.grossMinor,
      refundId: payments.stripeRefundId,
      isStripeRefund: isStripeRefundPaymentSql(),
      refundOf: payments.refundOfPaymentId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, input.reservationId),
        eq(payments.status, "completed"),
        or(
          inArray(payments.refundOfPaymentId, [...input.paymentIds]),
          and(
            sql`${payments.refundOfPaymentId} IS NULL`,
            isStripeRefundPaymentSql(),
            eq(payments.stripeChargeId, input.chargeId),
          ),
        ),
      ),
    )
    .orderBy(asc(payments.id));
  const stripeRefunds = new Map<string, number>();
  let manualMinor = 0;
  for (const row of rows) {
    if (Number(row.isStripeRefund) === 1 && row.refundId) {
      stripeRefunds.set(row.refundId, minorOf(row));
    } else if (row.refundOf && input.paymentIds.includes(row.refundOf)) {
      manualMinor += toStripeCents(Number(row.amount), charge.currency);
    }
  }
  const recordedStripeMinor = [...stripeRefunds.values()].reduce((sum, value) => sum + value, 0);

  const paidMinor = input.grossMinor ?? charge.amountCapturedMinor;
  const stripeLeft = charge.amountCapturedMinor - charge.amountRefundedMinor;
  const louezLeft = paidMinor - recordedStripeMinor;
  const refundableMinor = Math.max(
    0,
    Math.min(stripeLeft, louezLeft) - manualMinor - input.openMinor,
  );
  return {
    paidMinor,
    refundedMinor: Math.max(charge.amountRefundedMinor, recordedStripeMinor) + manualMinor,
    inFlightMinor: input.openMinor,
    refundableMinor,
    rows: rows.map((row) => ({
      id: row.id,
      amountMinor:
        Number(row.isStripeRefund) === 1
          ? minorOf(row)
          : toStripeCents(Number(row.amount), charge.currency),
    })),
  };
}

export type RefundOperation = {
  readonly id: string;
  readonly storeId: string;
  readonly reservationId: string;
  readonly paymentId: string;
  readonly status: "requested" | "unresolved" | "pending" | "succeeded" | "failed";
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: RefundReason;
  readonly notes: string | null;
  readonly refundType: "rental" | "deposit_return";
  readonly stripeRefundId: string | null;
  readonly refundPaymentId: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly approvalId: string | null;
  readonly requestedByUserId: string | null;
  readonly requestedByCredentialId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** An operation of the store, as it is now; null when the store has none of that id. */
export async function getRefundOperation(
  database: Database,
  input: { readonly storeId: string; readonly operationId: string },
): Promise<RefundOperation | null> {
  const o = paymentRefundOperations;
  const [row] = await database
    .select({
      id: o.id,
      storeId: o.storeId,
      reservationId: o.reservationId,
      paymentId: o.paymentId,
      status: o.status,
      amountMinor: o.amountMinor,
      currency: o.currency,
      reason: o.reason,
      notes: o.notes,
      refundType: o.refundType,
      stripeRefundId: o.stripeRefundId,
      refundPaymentId: o.refundPaymentId,
      failureCode: o.failureCode,
      failureMessage: o.failureMessage,
      approvalId: o.approvalId,
      requestedByUserId: o.requestedByUserId,
      requestedByCredentialId: o.requestedByCredentialId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })
    .from(o)
    .where(and(eq(o.id, input.operationId), eq(o.storeId, input.storeId)));
  return row ?? null;
}

export type StripeRefundDeps = {
  readonly database: Database;
  readonly stripe: StripeRefundPort;
  /** Runs the outbox rows a write added (the refund rows' credit notes), after its commit. */
  readonly dispatchEffects?: (ids: readonly string[]) => void | Promise<void>;
};

/** The app's dispatcher, loaded when first used: it imports this module's sender. */
const dispatchAppEffects = async (ids: readonly string[]) => {
  if (ids.length === 0) return;
  const { dispatchApiEffects } = await import("@/lib/api/effects");
  dispatchApiEffects(ids);
};

/**
 * A request in one call, for a caller with no transaction of its own: the charge read
 * at Stripe, the operation recorded in a transaction of its own, then one attempt
 * through the outbox's sender (`attemptNow`, which runs the outbox rows it is given,
 * with a short timeout). Answers the operation as it is after that attempt: still
 * `requested` when Stripe did not answer in time, the outbox then has it.
 */
export async function refundStripePayment(
  deps: StripeRefundDeps & { readonly attemptNow: (effectIds: readonly string[]) => Promise<void> },
  input: RefundRequestInput,
): Promise<RefundRefusal | { readonly ok: true; readonly operation: RefundOperation }> {
  const read = await readChargeForRefund(deps, input);
  if (!read.ok) return read;
  const requested = await deps.database.transaction(
    (tx) => requestStripeRefund(tx, { ...input, charge: read.charge }),
    REFUND_TRANSACTION,
  );
  if (!requested.ok) return requested;
  await deps.attemptNow(requested.effectIds);
  const operation = await getRefundOperation(deps.database, {
    storeId: input.storeId,
    operationId: requested.operationId,
  });
  if (!operation) throw new Error(`refund operation ${requested.operationId} is gone`);
  return { ok: true, operation };
}

type ClaimedOperation = {
  readonly id: string;
  readonly reservationId: string;
  readonly paymentId: string;
  readonly accountId: string;
  readonly chargeId: string;
  readonly amountMinor: number;
  readonly reason: RefundReason;
  /** The refund Stripe made for it, once Louez recorded it. */
  readonly stripeRefundId: string | null;
  readonly token: string;
  /** Sent now: Stripe has never seen its key, or the key's first request is under 23 hours. */
  readonly send: boolean;
  /** No request was sent before this one. */
  readonly fresh: boolean;
  /** The key's life is over since the last request: nothing more can come of it. */
  readonly windowOver: boolean;
};

type Claim =
  | { readonly kind: "claimed"; readonly operation: ClaimedOperation }
  | { readonly kind: "settled" }
  | { readonly kind: "gone" }
  | { readonly kind: "busy" };

/**
 * Claims the operation for one sender, under the reservation's row lock then the
 * operation's, on the database's clock. An operation another sender holds, or one whose
 * last attempt set a time before which none is made (`claimed_until`), is `busy`.
 * The time of the request is written before it leaves: a process that dies leaves it.
 * A `pending` one is claimed for a lookup only: Stripe made its refund, and it is never
 * sent again.
 */
async function claimOperation(database: Database, operationId: string): Promise<Claim> {
  const [peek] = await database
    .select({ reservationId: paymentRefundOperations.reservationId })
    .from(paymentRefundOperations)
    .where(eq(paymentRefundOperations.id, operationId));
  if (!peek) return { kind: "gone" };

  return database.transaction(async (tx) => {
    if (!(await lockRefundReservation(tx, peek.reservationId))) return { kind: "gone" as const };
    const o = paymentRefundOperations;
    const [operation] = await tx
      .select({
        id: o.id,
        reservationId: o.reservationId,
        paymentId: o.paymentId,
        accountId: o.stripeAccountId,
        chargeId: o.stripeChargeId,
        amountMinor: o.amountMinor,
        reason: o.reason,
        stripeRefundId: o.stripeRefundId,
        status: o.status,
        claimed: sql<number | null>`${o.claimedUntil} > NOW()`,
        sentBefore: sql<number>`${o.providerRequestedAt} IS NOT NULL`,
        keySendable: sql<number>`${o.providerRequestedAt} IS NULL OR ${o.createdAt} > NOW() - INTERVAL ${hours(KEY_SENDABLE_HOURS)} HOUR`,
        windowOver: sql<number>`${o.providerRequestedAt} < NOW() - INTERVAL ${hours(KEY_WINDOW_HOURS)} HOUR`,
      })
      .from(o)
      .where(eq(o.id, operationId))
      .for("update");
    if (!operation) return { kind: "gone" as const };
    if (!isUnsettledRefundStatus(operation.status)) return { kind: "settled" as const };
    if (Number(operation.claimed) === 1) return { kind: "busy" as const };

    const token = nanoid();
    const pending = operation.status === "pending";
    const send = !pending && Number(operation.keySendable) === 1;
    await tx
      .update(o)
      .set({
        claimToken: token,
        claimedUntil: sql`NOW() + INTERVAL ${sql.raw(String(REFUND_CLAIM_SECONDS))} SECOND`,
        providerRequestedAt: send ? sql`NOW()` : undefined,
        // Its key can no longer be sent: only Stripe's account of the charge settles it.
        status: send || pending ? undefined : "unresolved",
        updatedAt: sql`NOW()`,
      })
      .where(eq(o.id, operationId));
    return {
      kind: "claimed" as const,
      operation: {
        id: operation.id,
        reservationId: operation.reservationId,
        paymentId: operation.paymentId,
        accountId: operation.accountId,
        chargeId: operation.chargeId,
        amountMinor: operation.amountMinor,
        reason: operation.reason,
        stripeRefundId: operation.stripeRefundId,
        token,
        send,
        fresh: Number(operation.sentBefore) !== 1,
        windowOver: Number(operation.windowOver) === 1,
      },
    };
  }, REFUND_TRANSACTION);
}

/**
 * Gives the operation back, only under the claim this sender holds. One still open
 * waits before the next attempt (`retryNotBefore`), whoever makes it.
 */
async function releaseClaim(database: Database, operation: ClaimedOperation): Promise<void> {
  await database.transaction(async (tx) => {
    await lockRefundReservation(tx, operation.reservationId);
    const o = paymentRefundOperations;
    await tx
      .update(o)
      .set({
        claimToken: null,
        claimedUntil: sql`CASE WHEN ${o.status} IN ('requested', 'unresolved', 'pending') THEN ${retryNotBefore} ELSE NULL END`,
      })
      .where(
        and(
          eq(paymentRefundOperations.id, operation.id),
          eq(paymentRefundOperations.claimToken, operation.token),
        ),
      );
  }, REFUND_TRANSACTION);
}

/**
 * Closes the operation as `failed`, while it is still open under this sender's claim:
 * one another sender took over, or that the webhook settled, is theirs.
 */
async function failOperation(
  database: Database,
  operation: ClaimedOperation,
  failure: { readonly code: string; readonly message: string | null },
): Promise<void> {
  await database.transaction(async (tx) => {
    await lockRefundReservation(tx, operation.reservationId);
    await tx
      .update(paymentRefundOperations)
      .set({
        status: "failed",
        failureCode: failure.code.slice(0, 64),
        failureMessage: failure.message?.slice(0, 1000) ?? null,
        claimToken: null,
        claimedUntil: null,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(paymentRefundOperations.id, operation.id),
          inArray(paymentRefundOperations.status, [...OPEN_REFUND_STATUSES]),
          eq(paymentRefundOperations.claimToken, operation.token),
        ),
      );
  }, REFUND_TRANSACTION);
}

/** What Stripe has for the operation. */
type RefundVerdict =
  | {
      readonly kind: "found";
      readonly refund: ProviderRefund;
      /** The charge as it was read to find it, when it was. */
      readonly snapshot: ChargeSnapshot | null;
    }
  /** Stripe made no refund of it, and never will. */
  | { readonly kind: "absent"; readonly code: string; readonly message: string | null }
  /** Stripe may have made it, or may yet: nobody can tell now. */
  | { readonly kind: "unknown"; readonly message: string };

/**
 * Asks Stripe about the operation. Sent when its key may be: the answer of a request
 * sent again is the one of its first request. A first request Stripe refuses made
 * nothing. Whenever an answer tells less than that, the charge is read again with all
 * its refunds. Absence is proven only by Stripe's own account of the charge
 * (`lookUpOperationRefund`): a complete listing that names no refund of the operation
 * and adds up to what the charge says was refunded; and only once nothing can still
 * make the refund: a request sent again was refused, or the key's life is over since
 * the last request.
 */
async function askStripe(
  port: StripeRefundPort,
  operation: ClaimedOperation,
  context: Pick<EffectSendContext, "assertClaim" | "throwIfAborted">,
): Promise<RefundVerdict> {
  let refusal: { readonly code: string; readonly message: string } | null = null;
  let message = "no request sent: the key is too old to send again";
  if (operation.send) {
    // The outbox's claim is checked last, right before the request leaves.
    await context.assertClaim();
    const answer: RefundAnswer = await port.createRefund(
      {
        accountId: operation.accountId,
        chargeId: operation.chargeId,
        amountMinor: operation.amountMinor,
        operationId: operation.id,
        reservationId: operation.reservationId,
        reason: operation.reason,
      },
      refundIdempotencyKey(operation.id),
    );
    if (answer.kind === "created") {
      return { kind: "found", refund: answer.refund, snapshot: null };
    }
    if (answer.kind === "refused") {
      const code = answer.code ?? "stripe_refused";
      // Stripe refused this very request, the first: it made nothing.
      if (operation.fresh) return { kind: "absent", code, message: answer.message };
      // A request sent again was refused: what an earlier one left is looked up.
      refusal = { code, message: answer.message };
    }
    message =
      answer.kind === "key_reused"
        ? "the key was first sent with other parameters"
        : answer.kind === "indeterminate"
          ? `no answer${answer.replayed ? " (replayed)" : ""}: ${answer.message}`
          : answer.message;
    log.error({ stripeRefund: { operationId: operation.id, issue: answer.kind, message } });
  }

  context.throwIfAborted();
  const snapshot = await readChargeSnapshot(port, operation);
  const found = lookUpOperationRefund(snapshot, operation);
  if (found.kind === "found") return { kind: "found", refund: found.refund, snapshot };
  if (found.kind === "absent") {
    if (refusal) return { kind: "absent", ...refusal };
    if (!operation.send && operation.windowOver) {
      return {
        kind: "absent",
        code: "not_found_at_stripe",
        message: `Stripe's account of the charge holds no refund of the operation, ${KEY_WINDOW_HOURS} hours after its last request`,
      };
    }
  }
  return {
    kind: "unknown",
    message:
      found.kind === "unknown"
        ? `${message}; the charge's refunds are incomplete or do not add up to what it says was refunded`
        : message,
  };
}

/**
 * Records the refund Stripe made for the operation, with every refund of its charge,
 * through the one writer the webhook also runs.
 */
async function recordFound(
  deps: StripeRefundDeps,
  operation: ClaimedOperation,
  verdict: Extract<RefundVerdict, { kind: "found" }>,
  context: Pick<EffectSendContext, "throwIfAborted">,
): Promise<void> {
  context.throwIfAborted();
  const snapshot = verdict.snapshot ?? (await readChargeSnapshot(deps.stripe, operation));
  if (!snapshot.refunds) {
    throw new Error(`the refunds of ${operation.chargeId} could not all be read`);
  }
  // The request's answer and the listing are two reports of one refund: the one further
  // along stands (`laterRefundReport`), whichever was read last.
  const { refund } = verdict;
  const refunds = snapshot.refunds.some((candidate) => candidate.id === refund.id)
    ? snapshot.refunds.map((candidate) =>
        candidate.id === refund.id ? laterRefundReport(candidate, refund) : candidate,
      )
    : [refund, ...snapshot.refunds];
  const recorded = await recordChargeRefunds(deps.database, {
    paymentId: operation.paymentId,
    reservationId: operation.reservationId,
    chargeId: operation.chargeId,
    currency: snapshot.charge.currency,
    amountCapturedMinor: snapshot.charge.amountCapturedMinor,
    refunds,
    source: "stripe_refund_operation",
  });
  await (deps.dispatchEffects ?? dispatchAppEffects)(recorded.effectIds);
}

/**
 * The work of a `payment.refund` outbox row: settles the operation with Stripe. Skips
 * an operation already settled, or gone with its store. Throws while its outcome is
 * not known, so the outbox asks again later, under the same key while it may.
 */
export async function sendRefundOperation(
  deps: StripeRefundDeps,
  operationId: string,
  context: Pick<EffectSendContext, "assertClaim" | "throwIfAborted">,
): Promise<{ readonly skipped: string } | undefined> {
  const claim = await claimOperation(deps.database, operationId);
  if (claim.kind === "gone") return { skipped: "The refund operation is gone." };
  if (claim.kind === "settled") return { skipped: "The refund operation is settled." };
  if (claim.kind === "busy") {
    throw new Error(
      `refund operation ${operationId} is being sent by another sender, or waits before its next attempt`,
    );
  }
  const { operation } = claim;
  try {
    const verdict = await askStripe(deps.stripe, operation, context);
    if (verdict.kind === "found") {
      await recordFound(deps, operation, verdict, context);
      return undefined;
    }
    if (verdict.kind === "absent") {
      await failOperation(deps.database, operation, verdict);
      return undefined;
    }
    throw new Error(`refund operation ${operationId}: ${verdict.message}`);
  } finally {
    await releaseClaim(deps.database, operation).catch((error: unknown) => {
      log.error({
        stripeRefund: { operationId, issue: "claim_not_released", error: describeError(error) },
      });
    });
  }
}

/** How long a read waits on the one reconciliation it may trigger. */
export const RECONCILE_ON_READ_MS = 10_000;

/**
 * One attempt to settle an open operation for a caller that reads it: the outbox's own
 * sender, under the operation's own rules (its key while it may be sent, the lookup
 * after), never a second request beyond them. None while another attempt holds it or
 * before the time the last one set (`REFUND_RETRY_MIN_SECONDS`): the read answers the
 * state as stored, so reading often never calls Stripe more often. Waits at most
 * `timeoutMs`; what is left goes on, under the sender's claim. Never throws: an outcome
 * not known yet is the operation's state, as read after.
 */
export async function reconcileRefundOperation(
  deps: StripeRefundDeps,
  operationId: string,
  timeoutMs: number = RECONCILE_ON_READ_MS,
): Promise<void> {
  const attempt = sendRefundOperation(deps, operationId, {
    assertClaim: async () => {},
    throwIfAborted: () => {},
  }).catch((error: unknown) => {
    log.info({
      stripeRefund: { operationId, issue: "reconcile_on_read", error: describeError(error) },
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    attempt,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}

/** The sender of `payment.refund`. */
export function createStripeRefundEffectSenders(
  deps: StripeRefundDeps = { database: db, stripe: stripeRefunds },
): Pick<ApiEffectSenders, "payment.refund"> {
  return {
    "payment.refund": (payload, context) => sendRefundOperation(deps, payload.operationId, context),
  };
}

/**
 * An outbox row still to run for the operation, or one added less than an hour ago,
 * whatever became of it: an operation still open that has neither gets a new one.
 */
const refundInFlight = (operationId: SQL | string) =>
  sql`EXISTS (
    SELECT 1 FROM ${apiEffects}
    WHERE ${apiEffects.type} = 'payment.refund'
      AND JSON_UNQUOTE(JSON_EXTRACT(${apiEffects.payload}, '$.operationId')) = ${operationId}
      AND (
        ${apiEffects.status} IN ('pending', 'running', 'failed')
        OR ${apiEffects.createdAt} > NOW() - INTERVAL ${hours(REFUND_REQUEUE_HOURS)} HOUR
      )
  )`;

/** Most operations one pass looks at, and how long it may keep taking them. */
export const STALE_REFUNDS_PER_RUN = 20;
export const STALE_REFUNDS_RUN_BUDGET_MS = 10_000;

/**
 * The cron's pass over the operations not settled whose outbox row was abandoned,
 * pruned or ended (a `pending` operation's row ends once its lookup found the refund
 * still pending): each gets a new one, the open ones first, then the oldest, bounded per
 * run and in time, so a refund Stripe holds pending is looked up again about once an
 * hour until Stripe settles it, whether or not its refund events reach Louez. Under
 * the reservation's lock the operation is read again: one settled meanwhile, or given
 * a row by another run, adds nothing. Makes no Stripe call: the senders do, each with
 * a short timeout and no retry of the client's own. The new rows' ids, for the
 * dispatcher.
 */
export async function requeueStaleRefundOperations(
  database: Database,
  options: {
    readonly limit?: number;
    readonly budgetMs?: number;
    readonly clock?: () => number;
  } = {},
): Promise<string[]> {
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? STALE_REFUNDS_RUN_BUDGET_MS);
  const o = paymentRefundOperations;
  const stale = await database
    .select({ id: o.id, reservationId: o.reservationId, storeId: o.storeId })
    .from(o)
    .where(
      and(
        inArray(o.status, [...UNSETTLED_REFUND_STATUSES]),
        sql`NOT ${refundInFlight(sql`${o.id}`)}`,
      ),
    )
    .orderBy(sql`${o.status} = 'pending'`, asc(o.createdAt), asc(o.id))
    .limit(options.limit ?? STALE_REFUNDS_PER_RUN);

  const enqueued: string[] = [];
  for (const operation of stale) {
    if (clock() > deadline) break;
    const ids = await database.transaction(async (tx) => {
      if (!(await lockRefundReservation(tx, operation.reservationId))) return [];
      const [row] = await tx
        .select({ status: o.status, inFlight: sql<number>`${refundInFlight(operation.id)}` })
        .from(o)
        .where(eq(o.id, operation.id))
        .for("update");
      if (!row || !isUnsettledRefundStatus(row.status) || Number(row.inFlight) === 1) return [];
      return enqueueEffects(tx, operation.storeId, [
        { type: "payment.refund", payload: { operationId: operation.id } },
      ]);
    }, REFUND_TRANSACTION);
    enqueued.push(...ids);
  }
  return enqueued;
}

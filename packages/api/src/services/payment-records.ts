import {
  db,
  isReservationChangeBusyError,
  type Database,
  markReservation,
  payments,
  reservations,
  runReservationOnlyChange,
  type Transaction,
} from "@louez/db";
import type { StoreSettings } from "@louez/types";
import {
  currencyMinorDigits,
  exactMoneyDecimals,
  isStripeRefundRow,
  normalizeCurrency,
} from "@louez/utils";
import { and, asc, eq } from "drizzle-orm";

import {
  paymentRecordErrors,
  type DeletePaymentInput,
  type RecordDepositReturnInput,
  type RecordPaymentInput,
  type RecordRefundInput,
  type RefundBalance,
  type RefundCreditNoteStatus,
} from "../contracts/payment-records";
import { reservationErrors } from "../contracts/reservations";
import {
  raiseConfirmation,
  type ConfirmationPreview,
  type ConfirmationRefusal,
} from "../platform/confirmation";
import { enqueueEffects } from "../platform/effects";
import type {
  PaymentRecordsPort,
  PaymentRefundsPort,
  RefundCreditNoteOutcome,
} from "../platform/ports";
import type { ApprovalPresentation } from "./approval-display";
import {
  deletePaymentPresentation,
  recordDepositReturnPresentation,
  recordPaymentPresentation,
  recordRefundPresentation,
} from "./approval-presentations";
import {
  currencyMinorOf,
  depositReturnAmount,
  fromHundredths,
  hundredthsOf,
  paymentAmount,
  recordedPaymentAmount,
  refundAmount,
  type RefundVerdict,
} from "./payment-amount";

/**
 * The payments a store records by hand, as an agent or the in-app assistant
 * asks: `record`, `recordDepositReturn`, `recordPaymentRefund` (the
 * dashboard's refund dialog too) and `remove`. Each runs in one
 * transaction under the reservation's lock (`runReservationOnlyChange`,
 * packages/db): it reads what its preview shows and binds, asks for the
 * confirmation in that transaction, then writes. Two writes of one
 * reservation run one after the other, and each reads what the other
 * committed: a deposit return reads the balance the one before it left.
 *
 * Each refuses what it would refuse whatever anyone answered (the amount,
 * the reservation's status, the deposit's balance, a Stripe payment) before
 * it asks, so nobody is asked to approve what cannot happen, and once it has
 * asked it only writes: a refusal never follows an approval carried out.
 *
 * Kept as the hand-written tools had it: the amounts written in euros in the
 * previews and messages (`money`), no history line, and the refusals'
 * messages. The refund, which no hand-written tool had, writes its amounts
 * in the payment's own currency (`moneyIn`).
 */

/** Who writes, on which store, with which of the app's writers, and how the confirmation is asked. */
export interface PaymentWriteCaller<Port> {
  storeId: string;
  storeSettings: Pick<StoreSettings, "currency" | "tax"> | null;
  /** The app's writer (`ApiPorts.paymentRecords`, `ApiPorts.paymentRefunds`). */
  port: Port;
  /**
   * Asks for the confirmation in the write's transaction: null goes on, an
   * error stops. A new preview is recorded in that transaction, which then
   * commits. `presentation` is what a person reads first, built from the
   * preview's own values (services/approval-presentations.ts).
   */
  confirm: (
    tx: Transaction,
    confirmation: {
      preview: ConfirmationPreview;
      state: unknown;
      presentation?: ApprovalPresentation | null;
    },
  ) => Promise<ConfirmationRefusal | null>;
}

/** The payments recorded with the app's writer of a recorded payment. */
export type PaymentRecordsCaller = PaymentWriteCaller<PaymentRecordsPort>;

/**
 * An amount as the previews and messages wrote it: in euros, whatever the
 * reservation's currency, as the hand-written tools did.
 */
export function money(amount: string | number): string {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(value);
}

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error }
  | { ok: false; confirmation: ConfirmationRefusal };

/**
 * Runs `work` under the reservation's lock. A refusal returns rather than
 * throws, so its transaction commits what the confirmation recorded (a new
 * preview, a token spent); it is thrown once the transaction is over.
 */
async function underReservationLock<T>(
  storeId: string,
  reservationId: string,
  work: (tx: Transaction) => Promise<Outcome<T>>,
): Promise<T> {
  let outcome: Outcome<T>;
  try {
    outcome = await runReservationOnlyChange({ reservationId, storeId }, (tx) => work(tx));
  } catch (error) {
    if (isReservationChangeBusyError(error)) throw reservationErrors.busy(reservationId);
    throw error;
  }
  if (outcome.ok) return outcome.value;
  if ("confirmation" in outcome) return raiseConfirmation(outcome.confirmation);
  throw outcome.error;
}

const refused = (error: Error) => ({ ok: false as const, error });
const unconfirmed = (confirmation: ConfirmationRefusal) => ({ ok: false as const, confirmation });

async function lockedReservation(tx: Transaction, storeId: string, id: string) {
  const [row] = await tx
    .select({
      id: reservations.id,
      number: reservations.number,
      status: reservations.status,
    })
    .from(reservations)
    .where(and(eq(reservations.id, id), eq(reservations.storeId, storeId)));
  return row ?? null;
}

/**
 * The reservation's currency, frozen when it was created; the store's for a
 * reservation older than its own (`reservations.currency`): what a deleted
 * payment without a currency of its own is shown in.
 */
const currencyOf = (
  caller: Pick<PaymentRecordsCaller, "storeSettings">,
  reservation: { currency: string | null },
) => normalizeCurrency(reservation.currency, normalizeCurrency(caller.storeSettings?.currency));

/**
 * The billing facts the row will take (its currency, gross and insurance
 * share), computed by the app's writer under the reservation's lock from the
 * reservation, its lines and the store's settings as the call read them.
 * The write binds them with its preview, shows their currency, and hands the
 * writer these very values: a change between a preview and the call that
 * carries it out voids its token or approval when it changes the facts; one
 * that leaves them the same writes the same row, and does not.
 */
const factsOf = (
  tx: Transaction,
  caller: PaymentRecordsCaller,
  reservationId: string,
  input: { type: RecordPaymentInput["type"]; amount: string },
) =>
  caller.port.facts(tx, {
    reservationId,
    storeId: caller.storeId,
    storeSettings: caller.storeSettings,
    type: input.type,
    amount: input.amount,
  });

/** The notes a write records, shown with its preview when there are any. */
const notesOf = (notes: string | undefined) => (notes ? { notes } : {});

/** The amount's text (`paymentAmount`), then a negative amount outside an adjustment. */
function recordAmountRefusal(input: RecordPaymentInput): Error | null {
  const verdict = recordedPaymentAmount(input.amount, input.type);
  if (verdict.ok) return null;
  return verdict.refusal === "amount_invalid"
    ? paymentRecordErrors.amountInvalid()
    : paymentRecordErrors.negativeOutsideAdjustment();
}

/** Records a payment received, or paid back as a negative adjustment. */
export async function recordPayment(caller: PaymentRecordsCaller, input: RecordPaymentInput) {
  const { storeId } = caller;
  return underReservationLock(storeId, input.reservationId, async (tx) => {
    const reservation = await lockedReservation(tx, storeId, input.reservationId);
    if (!reservation) {
      return refused(
        recordAmountRefusal(input) ?? paymentRecordErrors.reservationNotFound(input.reservationId),
      );
    }

    // Refused whatever anyone answers: before asking.
    const amountRefusal = recordAmountRefusal(input);
    if (amountRefusal) return refused(amountRefusal);
    if (reservation.status === "cancelled" || reservation.status === "rejected") {
      return refused(paymentRecordErrors.reservationClosed(reservation.status));
    }

    const facts = await factsOf(tx, caller, reservation.id, input);
    // The reservation as read: one record, whatever case its id was sent in.
    const details = {
      reservationId: reservation.id,
      number: reservation.number,
      type: input.type,
      amount: input.amount,
      method: input.method,
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Record a ${input.type} payment of ${money(input.amount)} (${input.method}) on reservation #${reservation.number}.`,
        details: { ...details, ...notesOf(input.notes) },
      },
      state: { status: reservation.status, facts },
      presentation: recordPaymentPresentation(details, facts.currency),
    });
    if (refusal) return unconfirmed(refusal);

    await caller.port.insert(tx, {
      reservationId: reservation.id,
      storeId,
      type: input.type,
      method: input.method,
      amount: input.amount,
      origin: "manual",
      paidAt: new Date(),
      notes: input.notes ?? null,
      facts,
    });
    return {
      ok: true,
      value: {
        reservationId: reservation.id,
        number: reservation.number,
        type: input.type,
        amount: input.amount,
        method: input.method,
      },
    };
  });
}

/** The amount's text (`paymentAmount`), or zero and below; the balance is judged under the lock. */
function returnAmountRefusal(input: RecordDepositReturnInput): Error | null {
  const verdict = depositReturnAmount(input.amount, Infinity);
  return verdict.ok ? null : paymentRecordErrors.depositReturnAmountInvalid();
}

/**
 * Records a deposit the store already gave back. Refused above the deposit
 * collected and not yet returned, read under the lock: the balance the
 * preview binds is the one the refusal checks.
 */
export async function recordDepositReturn(
  caller: PaymentRecordsCaller,
  input: RecordDepositReturnInput,
) {
  const { storeId } = caller;
  return underReservationLock(storeId, input.reservationId, async (tx) => {
    const reservation = await lockedReservation(tx, storeId, input.reservationId);
    if (!reservation) {
      return refused(
        returnAmountRefusal(input) ?? paymentRecordErrors.reservationNotFound(input.reservationId),
      );
    }
    const rows = await tx
      .select({ type: payments.type, status: payments.status, amount: payments.amount })
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));
    const completed = (type: string) =>
      rows
        .filter((row) => row.type === type && row.status === "completed")
        .reduce((sum, row) => sum + parseFloat(row.amount), 0);
    const collected = completed("deposit");
    const returned = completed("deposit_return");
    const returnable = collected - returned;

    // Refused whatever anyone answers: before asking.
    const verdict = depositReturnAmount(input.amount, returnable);
    if (!verdict.ok) {
      return refused(
        verdict.refusal === "amount_invalid"
          ? paymentRecordErrors.depositReturnAmountInvalid()
          : paymentRecordErrors.depositReturnExceedsBalance(
              {
                collected: collected.toFixed(2),
                returned: returned.toFixed(2),
                returnable: returnable.toFixed(2),
              },
              money,
            ),
      );
    }

    const facts = await factsOf(tx, caller, reservation.id, {
      type: "deposit_return",
      amount: input.amount,
    });
    // The reservation as read: one record, whatever case its id was sent in.
    const details = {
      reservationId: reservation.id,
      number: reservation.number,
      amount: input.amount,
      method: input.method,
      returnable: returnable.toFixed(2),
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Record a deposit return of ${money(input.amount)} (${input.method}) on reservation #${reservation.number}.`,
        details: { ...details, ...notesOf(input.notes) },
      },
      state: { returnable: returnable.toFixed(2), facts },
      presentation: recordDepositReturnPresentation(details, facts.currency, returnable),
    });
    if (refusal) return unconfirmed(refusal);

    await caller.port.insert(tx, {
      reservationId: reservation.id,
      storeId,
      type: "deposit_return",
      method: input.method,
      amount: input.amount,
      origin: "deposit",
      paidAt: new Date(),
      notes: input.notes ?? null,
      facts,
    });
    return {
      ok: true,
      value: {
        reservationId: reservation.id,
        number: reservation.number,
        amount: input.amount,
        method: input.method,
      },
    };
  });
}

/** A payment of the store with its reservation, as the payment writes read it. */
function selectStorePayment(executor: Database | Transaction, storeId: string, id: string) {
  return executor
    .select({
      id: payments.id,
      reservationId: payments.reservationId,
      type: payments.type,
      amount: payments.amount,
      method: payments.method,
      status: payments.status,
      currency: payments.currency,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
      refundOfPaymentId: payments.refundOfPaymentId,
      stripeRefundId: payments.stripeRefundId,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      number: reservations.number,
      reservationCurrency: reservations.currency,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(eq(payments.id, id), eq(reservations.storeId, storeId)));
}

/** A payment of the store with its reservation, read under that reservation's lock or before it. */
async function storePayment(executor: Database | Transaction, storeId: string, id: string) {
  const [row] = await selectStorePayment(executor, storeId, id);
  return row ?? null;
}

type StorePayment = NonNullable<Awaited<ReturnType<typeof storePayment>>>;

/**
 * Deletes a payment recorded by hand, and marks its reservation for the
 * billing service in the same transaction. A Stripe payment is refused.
 */
export async function deletePayment(caller: PaymentRecordsCaller, input: DeletePaymentInput) {
  const { storeId } = caller;
  // Which reservation to lock; read again under its lock.
  const found = await storePayment(db, storeId, input.paymentId);
  if (!found) throw paymentRecordErrors.paymentNotFound(input.paymentId);

  return underReservationLock(storeId, found.reservationId, async (tx) => {
    const payment = await storePayment(tx, storeId, input.paymentId);
    if (!payment) return refused(paymentRecordErrors.paymentNotFound(input.paymentId));
    // Refused whatever anyone answers: before asking.
    if (payment.method === "stripe")
      return refused(paymentRecordErrors.stripePaymentNotDeletable());

    // The payment as read: one record, whatever case its id was sent in.
    const details = {
      paymentId: payment.id,
      number: payment.number,
      type: payment.type,
      amount: payment.amount,
      method: payment.method,
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Delete the ${payment.type} payment of ${money(payment.amount)} (${payment.method}) on reservation #${payment.number}.`,
        details,
      },
      state: { amount: payment.amount, status: payment.status },
      presentation: deletePaymentPresentation(details, {
        reservationId: payment.reservationId,
        // The payment's own currency, else its reservation's, else the store's.
        currency: normalizeCurrency(
          payment.currency,
          currencyOf(caller, { currency: payment.reservationCurrency }),
        ),
        recordedAt: payment.paidAt ?? payment.createdAt,
      }),
    });
    if (refusal) return unconfirmed(refusal);

    await tx
      .delete(payments)
      .where(and(eq(payments.id, payment.id), eq(payments.reservationId, payment.reservationId)));
    await markReservation(tx, { id: payment.reservationId, storeId });
    return {
      ok: true,
      value: {
        paymentId: payment.id,
        reservationId: payment.reservationId,
        number: payment.number,
      },
    };
  });
}

// --- A refund given by hand ------------------------------------------------------

/** The payments a refund may give back: money the store received, and a deposit it kept. */
const REFUNDABLE_TYPES: ReadonlySet<string> = new Set([
  "rental",
  "damage",
  "adjustment",
  "deposit_capture",
]);

/** The methods of a payment taken by hand: anything but Stripe. */
const MANUAL_METHODS: ReadonlySet<string> = new Set(["cash", "card", "transfer", "check", "other"]);

/**
 * An amount in a payment's own currency, as the refund's preview and its
 * refusals write it (`£30.00`, `¥1,500`): with exactly the digits it holds
 * (`exactMoneyDecimals`), as the approval's page writes it, so the two never
 * disagree. Never the euros of `money`, which the older writes keep.
 */
export function moneyIn(amount: string, currency: string): string {
  const decimals = exactMoneyDecimals(amount, currency);
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(amount));
}

/**
 * Why a payment cannot be refunded by hand, whatever the amount: a refund's
 * own row (one linked to another, or a Stripe refund, `isStripeRefundRow`),
 * a type that holds no money to give back, a payment not completed, a
 * payment taken through Stripe, or one of zero or below.
 */
function refundablePaymentRefusal(payment: StorePayment): Error | null {
  if (payment.refundOfPaymentId !== null || isStripeRefundRow(payment)) {
    return paymentRecordErrors.refundOfRefund();
  }
  if (!REFUNDABLE_TYPES.has(payment.type)) {
    return paymentRecordErrors.refundTypeNotRefundable(payment.type);
  }
  if (payment.status !== "completed") {
    return paymentRecordErrors.refundPaymentNotCompleted(payment.status);
  }
  if (!MANUAL_METHODS.has(payment.method)) return paymentRecordErrors.refundStripePayment();
  if (!(hundredthsOf(payment.amount) > 0)) return paymentRecordErrors.refundPaymentNotReceived();
  return null;
}

/** Where the refund's credit note stands, as the answer says it. */
export interface RefundCreditNote {
  status: RefundCreditNoteStatus;
  number: string | null;
}

/** What a refund given by hand answers: its row, the payment it gives back, its credit note. */
export interface RecordedPaymentRefund {
  refundId: string;
  paymentId: string;
  reservationId: string;
  number: string;
  amount: string;
  currency: string;
  method: RecordRefundInput["method"];
  creditNote: RefundCreditNote;
}

/** A refund's writer: who writes, with the app's refund writer, and the outbox's dispatch. */
export interface PaymentRefundCaller extends PaymentWriteCaller<PaymentRefundsPort> {
  /** Sends committed outbox rows (`ApiPorts.dispatchEffects`). Never throws. */
  dispatchEffects: (ids: readonly string[]) => void;
}

/** The refusal of an amount `refundAmount` judged, for the payment's currency and balance. */
function refundAmountRefusal(
  refusal: Exclude<RefundVerdict, { ok: true }>["refusal"],
  currency: string,
  balance: RefundBalance,
): Error {
  switch (refusal) {
    case "amount_invalid":
      return paymentRecordErrors.refundAmountInvalid();
    case "too_precise":
      return paymentRecordErrors.refundAmountTooPrecise(currency, currencyMinorDigits(currency) ?? 0);
    case "currency_unsupported":
      return paymentRecordErrors.refundCurrencyNotSupported(currency);
    case "exceeds_refundable":
      return paymentRecordErrors.refundExceedsRefundable(balance, (amount) => moneyIn(amount, currency));
  }
}

/** The one attempt at the credit note after the commit, as the answer says it. */
async function attemptCreditNote(
  caller: PaymentRefundCaller,
  refund: { paymentId: string; refundId: string; amount: string },
  source: string,
): Promise<RefundCreditNote> {
  let outcome: RefundCreditNoteOutcome;
  try {
    outcome = await caller.port.creditNote({
      paymentId: refund.paymentId,
      refundId: refund.refundId,
      amount: refund.amount,
      source,
    });
  } catch (error) {
    outcome = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  if (outcome.status === "issued") return { status: "issued", number: outcome.number };
  if (outcome.status === "not_applicable") return { status: "not_applicable", number: null };
  // Owed all the same: the outbox row added with the refund issues it.
  return { status: "pending", number: null };
}

/**
 * Records a refund the store gave by hand (cash, a card terminal, a
 * transfer, a cheque) against one payment: one positive `completed` row
 * pointing at that payment (`refundOfPaymentId`), with its own method, in
 * the payment's own currency; the payment keeps its amount. It moves no
 * money. The dashboard's refund dialog and `dashboard.payments.recordRefund`
 * both record through it (docs/domain/reservation-invariants.md, M8).
 *
 * Under the reservation's lock, then the payment's row: refused for a
 * payment that is not one the store took by hand and can give back
 * (`refundablePaymentRefusal`), for an amount its currency cannot hold
 * (`currencyFit`), and above the payment's amount less every completed
 * refund linked to it, read under that lock, so two refunds sent together
 * never pass it between them. The preview binds the payment's status and
 * amount and those refunds: one recorded between an approval and the call
 * that carries it out voids it.
 *
 * The credit note is owed by an outbox row added in the refund's own
 * transaction (`payment.refundCreditNote`): once committed, the writer tries
 * it once and says where it stands (`issued`, `pending`, `not_applicable`),
 * then hands the row to the outbox, which issues it if the attempt did not.
 * The invoicing issues one credit note per refund, whoever asks first.
 *
 * `reservationId`, when given (the dashboard's page), must be the payment's:
 * a payment of another reservation is not found.
 */
export async function recordPaymentRefund(
  caller: PaymentRefundCaller,
  input: RecordRefundInput & { reservationId?: string },
  options: { source: string },
): Promise<RecordedPaymentRefund> {
  const { storeId } = caller;
  // Refused whatever anyone answers, before anything is read: the text, and
  // zero and below. The currency is the payment's, read under the lock.
  const text = paymentAmount(input.amount);
  if (!text || text.startsWith("-")) throw paymentRecordErrors.refundAmountInvalid();
  const ofThisCall = (payment: StorePayment | null) =>
    payment && (!input.reservationId || payment.reservationId === input.reservationId)
      ? payment
      : null;
  // Which reservation to lock; read again under its lock.
  const found = ofThisCall(await storePayment(db, storeId, input.paymentId));
  if (!found) throw paymentRecordErrors.paymentNotFound(input.paymentId);

  const recorded = await underReservationLock(storeId, found.reservationId, async (tx) => {
    // The reservation's lock, then the payment's row: the order of every writer.
    const [locked] = await selectStorePayment(tx, storeId, input.paymentId).for("update");
    const payment = ofThisCall(locked ?? null);
    if (!payment || payment.reservationId !== found.reservationId) {
      return refused(paymentRecordErrors.paymentNotFound(input.paymentId));
    }
    // Refused whatever anyone answers: before asking.
    const paymentRefusal = refundablePaymentRefusal(payment);
    if (paymentRefusal) return refused(paymentRefusal);

    const refunds = await tx
      .select({ id: payments.id, amount: payments.amount })
      .from(payments)
      .where(and(eq(payments.refundOfPaymentId, payment.id), eq(payments.status, "completed")))
      .orderBy(asc(payments.id));
    const paid = hundredthsOf(payment.amount);
    const refunded = refunds.reduce((sum, row) => sum + hundredthsOf(row.amount), 0);
    const refundable = Math.max(0, paid - refunded);
    // The payment's own currency, else its reservation's, else the store's.
    const currency = normalizeCurrency(
      payment.currency,
      currencyOf(caller, { currency: payment.reservationCurrency }),
    );
    const inCurrency = (amount: string) => moneyIn(amount, currency);

    const verdict = refundAmount(input.amount, currency, refundable);
    if (!verdict.ok) {
      return refused(
        refundAmountRefusal(verdict.refusal, currency, {
          paid: fromHundredths(paid),
          refunded: fromHundredths(refunded),
          refundable: fromHundredths(refundable),
          currency,
        }),
      );
    }
    const { amount } = verdict;
    const notes = input.notes?.trim() || null;

    // The payment as read: one record, whatever case its id was sent in.
    const details = {
      paymentId: payment.id,
      reservationId: payment.reservationId,
      number: payment.number,
      amount,
      method: input.method,
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Record a refund of ${inCurrency(amount)} (${input.method}) of the ${payment.type} payment of ${inCurrency(payment.amount)} on reservation #${payment.number}.`,
        details: {
          ...details,
          currency,
          payment: { type: payment.type, amount: payment.amount, method: payment.method },
          alreadyRefunded: fromHundredths(refunded),
          refundableAfter: fromHundredths(refundable - hundredthsOf(amount)),
          ...(notes ? { notes } : {}),
        },
      },
      // In the currency's minor units (yen, cents): the payment's, its refunds', this one's.
      state: {
        refund: {
          amountMinor: currencyMinorOf(amount, currency),
          currency,
          method: input.method,
        },
        payment: { status: payment.status, amountMinor: currencyMinorOf(payment.amount, currency) },
        refunds: refunds.map((row) => ({
          id: row.id,
          amountMinor: currencyMinorOf(row.amount, currency),
        })),
      },
      presentation: recordRefundPresentation(details, {
        type: payment.type,
        amount: payment.amount,
        method: payment.method,
        currency,
        paidAt: payment.paidAt ?? payment.createdAt,
        paidHundredths: paid,
        refundedHundredths: refunded,
      }),
    });
    if (refusal) return unconfirmed(refusal);

    const { id } = await caller.port.insert(tx, {
      reservationId: payment.reservationId,
      storeId,
      paymentId: payment.id,
      type: payment.type === "deposit_capture" ? "deposit_return" : "rental",
      method: input.method,
      amount,
      currency,
      paidAt: new Date(),
      notes,
    });
    // Owed with the refund, in its transaction: a crash after the commit leaves it owed.
    const effectIds = await enqueueEffects(tx, storeId, [
      {
        type: "payment.refundCreditNote",
        reservationId: payment.reservationId,
        payload: {
          storeId,
          reservationId: payment.reservationId,
          paymentId: payment.id,
          refundId: id,
          amount,
          source: options.source,
        },
      },
    ]);
    return {
      ok: true,
      value: {
        effectIds,
        refund: {
          refundId: id,
          paymentId: payment.id,
          reservationId: payment.reservationId,
          number: payment.number,
          amount,
          currency,
          method: input.method,
        },
      },
    };
  });

  const { refund, effectIds } = recorded;
  const creditNote = await attemptCreditNote(caller, refund, options.source);
  caller.dispatchEffects(effectIds);
  return { ...refund, creditNote };
}

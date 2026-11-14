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
import { normalizeCurrency } from "@louez/utils";
import { and, eq } from "drizzle-orm";

import {
  paymentRecordErrors,
  type DeletePaymentInput,
  type RecordDepositReturnInput,
  type RecordPaymentInput,
} from "../contracts/payment-records";
import { reservationErrors } from "../contracts/reservations";
import {
  raiseConfirmation,
  type ConfirmationPreview,
  type ConfirmationRefusal,
} from "../platform/confirmation";
import type { PaymentRecordsPort } from "../platform/ports";
import type { ApprovalPresentation } from "./approval-display";
import {
  deletePaymentPresentation,
  recordDepositReturnPresentation,
  recordPaymentPresentation,
} from "./approval-presentations";

/**
 * The payments a store records by hand, as an agent or the in-app assistant
 * asks: `record`, `recordDepositReturn` and `remove`. Each runs in one
 * transaction under the reservation's lock (`runReservationOnlyChange`,
 * packages/db): it reads what its preview shows and binds, asks for the
 * confirmation in that transaction, then writes. Two writes of one
 * reservation run one after the other, and each reads what the other
 * committed: a deposit return reads the balance the one before it left.
 *
 * Kept as the hand-written tools had it: the amounts written in euros in the
 * previews and messages (`money`), the confirmation asked before the checks
 * of the amount and the status, no history line, and the refusals' messages.
 */

/** Who writes, on which store, and how the confirmation is asked. */
export interface PaymentRecordsCaller {
  storeId: string;
  storeSettings: Pick<StoreSettings, "currency" | "tax"> | null;
  /** The app's writer of a recorded payment (`ApiPorts.paymentRecords`). */
  port: PaymentRecordsPort;
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
      currency: reservations.currency,
    })
    .from(reservations)
    .where(and(eq(reservations.id, id), eq(reservations.storeId, storeId)));
  return row ?? null;
}

/**
 * The reservation's currency, frozen when it was created; the store's for a
 * reservation older than its own (`reservations.currency`): the one the
 * writer records the payment in (apps/web `reservationCurrency`).
 */
const currencyOf = (caller: PaymentRecordsCaller, reservation: { currency: string | null }) =>
  normalizeCurrency(reservation.currency, normalizeCurrency(caller.storeSettings?.currency));

/** Not a number, or zero; then a negative amount outside an adjustment. */
function recordAmountRefusal(input: RecordPaymentInput): Error | null {
  const amount = parseFloat(input.amount);
  if (isNaN(amount) || amount === 0) return paymentRecordErrors.amountInvalid();
  if (amount < 0 && input.type !== "adjustment") {
    return paymentRecordErrors.negativeOutsideAdjustment();
  }
  return null;
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

    const details = {
      reservationId: input.reservationId,
      number: reservation.number,
      type: input.type,
      amount: input.amount,
      method: input.method,
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Record a ${input.type} payment of ${money(input.amount)} (${input.method}) on reservation #${reservation.number}.`,
        details,
      },
      state: { status: reservation.status },
      presentation: recordPaymentPresentation(details, currencyOf(caller, reservation)),
    });
    if (refusal) return unconfirmed(refusal);

    const amountRefusal = recordAmountRefusal(input);
    if (amountRefusal) return refused(amountRefusal);
    if (reservation.status === "cancelled" || reservation.status === "rejected") {
      return refused(paymentRecordErrors.reservationClosed(reservation.status));
    }

    await caller.port.insert(tx, {
      reservationId: reservation.id,
      storeId,
      storeSettings: caller.storeSettings,
      type: input.type,
      method: input.method,
      amount: input.amount,
      origin: "manual",
      paidAt: new Date(),
      notes: input.notes ?? null,
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

/** Not a number, zero or below. */
function returnAmountRefusal(input: RecordDepositReturnInput): Error | null {
  const amount = parseFloat(input.amount);
  return isNaN(amount) || amount <= 0 ? paymentRecordErrors.depositReturnAmountInvalid() : null;
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

    const details = {
      reservationId: input.reservationId,
      number: reservation.number,
      amount: input.amount,
      method: input.method,
      returnable: returnable.toFixed(2),
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Record a deposit return of ${money(input.amount)} (${input.method}) on reservation #${reservation.number}.`,
        details,
      },
      state: { returnable: returnable.toFixed(2) },
      presentation: recordDepositReturnPresentation(details, currencyOf(caller, reservation)),
    });
    if (refusal) return unconfirmed(refusal);

    const amountRefusal = returnAmountRefusal(input);
    if (amountRefusal) return refused(amountRefusal);
    if (parseFloat(input.amount) > returnable) {
      return refused(
        paymentRecordErrors.depositReturnExceedsBalance(
          {
            collected: collected.toFixed(2),
            returned: returned.toFixed(2),
            returnable: returnable.toFixed(2),
          },
          money,
        ),
      );
    }

    await caller.port.insert(tx, {
      reservationId: reservation.id,
      storeId,
      storeSettings: caller.storeSettings,
      type: "deposit_return",
      method: input.method,
      amount: input.amount,
      origin: "deposit",
      paidAt: new Date(),
      notes: input.notes ?? null,
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

/** A payment of the store with its reservation, read under that reservation's lock or before it. */
async function storePayment(executor: Database | Transaction, storeId: string, id: string) {
  const [row] = await executor
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
      number: reservations.number,
      reservationCurrency: reservations.currency,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(eq(payments.id, id), eq(reservations.storeId, storeId)));
  return row ?? null;
}

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

    const details = {
      paymentId: input.paymentId,
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

    if (payment.method === "stripe")
      return refused(paymentRecordErrors.stripePaymentNotDeletable());

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

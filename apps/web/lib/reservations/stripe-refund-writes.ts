import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type Database,
  type Transaction,
  isStripeRefundPaymentSql,
  markReservationIds,
  paymentRefundOperations,
  payments,
  reservationActivity,
  reservations,
} from "@louez/db";

import { log } from "@/lib/evlog";
import { tryGenerateCreditNoteForRefund } from "@/lib/invoicing/service";
import { grossMinorOf } from "@/lib/reservations/payment-billing-facts";
import { fromStripeCents } from "@/lib/stripe";

import { type ProviderRefund, refundMovedMoney } from "./stripe-refund-stripe";

// The one writer of what Stripe says of a charge's refunds, whoever hears it: the
// sender of a refund operation (stripe-refund.ts) or the Connect webhook's
// `charge.refunded` (app/api/webhooks/stripe/connect/charge-refund.ts). In one
// transaction, under the reservation's row lock, then the operations' rows, then the
// payment's: the payment netted, one refund row per refund that moved money, and the
// operation each refund answers settled. The same refunds heard twice, or by both, in
// either order, write the same rows once.

/** Every transaction of a refund writer: no snapshot older than its locks. */
export const REFUND_TRANSACTION = { isolationLevel: "read committed" } as const;

/** Locks the reservation's row: the first lock of every write about a refund. */
export async function lockRefundReservation(
  tx: Transaction,
  reservationId: string,
): Promise<{ readonly storeId: string } | null> {
  const [row] = await tx
    .select({ storeId: reservations.storeId })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .for("update");
  return row ?? null;
}

export type RefundPaymentRecordInput = {
  originalPaymentId: string;
  stripeRefundId: string;
  amount: string | number;
  currency: string;
  type: "rental" | "deposit_return";
  paidAt: Date;
  notes?: string | null;
  /** Stripe's refund amount in minor units; derived from `amount` when absent. */
  grossMinor?: number;
};

/**
 * Writes the row of a Stripe refund, once per refund of the reservation: a refund
 * already recorded keeps its row, whose id is answered. Called in a transaction that
 * holds the reservation's row lock, then the original payment's (the order of every
 * writer of a refund: reservation, refund operation, payment), by the one writer of
 * a charge's refunds below.
 */
export async function ensureRefundPaymentRecord(
  tx: Transaction,
  input: RefundPaymentRecordInput,
): Promise<string> {
  const originalPayment = await tx.query.payments.findFirst({
    where: eq(payments.id, input.originalPaymentId),
    columns: { reservationId: true },
  });
  if (!originalPayment) throw new Error("Original refund payment not found");

  const existingRefund = await tx.query.payments.findFirst({
    where: and(
      eq(payments.reservationId, originalPayment.reservationId),
      eq(payments.stripeRefundId, input.stripeRefundId),
    ),
    columns: { id: true },
  });
  if (existingRefund) return existingRefund.id;

  const refundPaymentId = nanoid();
  const amount = Number(input.amount).toFixed(2);
  await tx.insert(payments).values({
    id: refundPaymentId,
    reservationId: originalPayment.reservationId,
    amount,
    type: input.type,
    method: "stripe",
    status: "completed",
    stripeRefundId: input.stripeRefundId,
    // Lets the cash ledger add the refund back to the charge the webhook
    // brought down to its net amount. Readers that subtract refunds must skip
    // Stripe refund rows: that charge is already net.
    refundOfPaymentId: input.originalPaymentId,
    currency: input.currency,
    // The billing service gets this refund folded onto the payment it refunds,
    // never as a payment, so the row has no origin and no insurance share.
    grossMinor: input.grossMinor ?? grossMinorOf(amount, input.currency),
    insuranceShareMinor: 0,
    notes: input.notes ?? null,
    paidAt: input.paidAt,
    createdAt: input.paidAt,
    updatedAt: input.paidAt,
  });
  await markReservationIds(tx, [originalPayment.reservationId]);
  return refundPaymentId;
}

/** A deposit's money goes back as a deposit return; the rest as a rental refund. */
export const refundTypeOf = (paymentType: string): "rental" | "deposit_return" =>
  paymentType === "deposit" || paymentType === "deposit_capture" ? "deposit_return" : "rental";

export type RecordedRefundRow = {
  readonly refundId: string;
  readonly refundPaymentId: string;
  /** In the charge's currency. */
  readonly amount: number;
};

export type RecordedChargeRefunds = {
  /** The refund row of each refund that moved money, written now or before. */
  readonly rows: readonly RecordedRefundRow[];
  /** What the store keeps of the charge. */
  readonly netMinor: number;
  /** The operations this write settled, `succeeded` or `failed`. */
  readonly settledOperationIds: readonly string[];
};

/**
 * Writes what Stripe lists of a charge's refunds on the payment that holds its money.
 *
 * The payment is brought down to what the store keeps: the charge's captured amount
 * less every refund that moved money, those Stripe lists and those already recorded
 * for this payment that the listing does not show failed. So a listing read before
 * another refund and written after it never raises the payment again. Only `amount`
 * is netted: `gross_minor` keeps the charge amount (billing README Q7). A payment
 * found through its PaymentIntent gets the charge id it lacked (Q36).
 *
 * A refund whose metadata names an operation, or the refund an operation already
 * names, settles that operation in the same transaction: `succeeded` with its refund
 * and its row when it moved money, `failed` with Stripe's reason otherwise. An
 * operation of another payment or charge is left alone (its id was put on a refund by
 * hand); a refund that names none is recorded as every refund made in Stripe's
 * dashboard always was.
 */
export async function recordChargeRefunds(
  database: Database,
  input: {
    readonly paymentId: string;
    readonly reservationId: string;
    readonly chargeId: string;
    /** Upper case: the charge's. */
    readonly currency: string;
    readonly amountCapturedMinor: number;
    /** Every refund of the charge, as Stripe lists it now. */
    readonly refunds: readonly ProviderRefund[];
  },
): Promise<RecordedChargeRefunds> {
  const { paymentId, chargeId, currency } = input;
  return database.transaction(async (tx) => {
    const reservation = await lockRefundReservation(tx, input.reservationId);
    if (!reservation) throw new Error(`reservation ${input.reservationId} not found`);

    const refundIds = input.refunds.map((refund) => refund.id);
    const namedOperationIds = input.refunds.flatMap((refund) =>
      refund.operationId ? [refund.operationId] : [],
    );
    const operationMatch = [
      ...(namedOperationIds.length > 0
        ? [inArray(paymentRefundOperations.id, namedOperationIds)]
        : []),
      ...(refundIds.length > 0 ? [inArray(paymentRefundOperations.stripeRefundId, refundIds)] : []),
    ];
    const operations =
      operationMatch.length > 0
        ? await tx
            .select({
              id: paymentRefundOperations.id,
              paymentId: paymentRefundOperations.paymentId,
              chargeId: paymentRefundOperations.stripeChargeId,
              status: paymentRefundOperations.status,
              refundType: paymentRefundOperations.refundType,
              notes: paymentRefundOperations.notes,
              stripeRefundId: paymentRefundOperations.stripeRefundId,
              refundPaymentId: paymentRefundOperations.refundPaymentId,
              amountMinor: paymentRefundOperations.amountMinor,
            })
            .from(paymentRefundOperations)
            .where(or(...operationMatch))
            .orderBy(asc(paymentRefundOperations.id))
            .for("update")
        : [];

    const [payment] = await tx
      .select({ type: payments.type, reservationId: payments.reservationId })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update");
    if (!payment || payment.reservationId !== input.reservationId) {
      throw new Error(`payment ${paymentId} not found on reservation ${input.reservationId}`);
    }

    // An operation of another payment or charge is never settled from this charge:
    // its id was put on a refund by hand.
    const ours = operations.filter(
      (operation) => operation.paymentId === paymentId && operation.chargeId === chargeId,
    );
    /** The operation a refund answers, when it is this payment's. */
    const operationOf = (refund: ProviderRefund) => {
      const operation =
        ours.find((candidate) => candidate.stripeRefundId === refund.id) ??
        ours.find(
          (candidate) => candidate.id === refund.operationId && candidate.stripeRefundId === null,
        );
      if (!operation && refund.operationId && !ours.some((o) => o.id === refund.operationId)) {
        const named = operations.find((candidate) => candidate.id === refund.operationId);
        if (named) {
          log.error({
            stripeRefund: {
              issue: "operation_of_another_charge",
              operationId: named.id,
              refundId: refund.id,
              chargeId,
            },
          });
        }
      }
      return operation ?? null;
    };

    const rows: RecordedRefundRow[] = [];
    const settledOperationIds: string[] = [];
    for (const refund of input.refunds) {
      const operation = operationOf(refund);
      if (!refundMovedMoney(refund)) {
        if (operation && operation.status !== "failed") {
          await tx
            .update(paymentRefundOperations)
            .set({
              status: "failed",
              stripeRefundId: refund.id,
              failureCode: (refund.failureReason ?? refund.status ?? "failed").slice(0, 64),
              failureMessage: null,
              claimToken: null,
              claimedUntil: null,
              updatedAt: sql`NOW()`,
            })
            .where(eq(paymentRefundOperations.id, operation.id));
          settledOperationIds.push(operation.id);
        }
        continue;
      }

      const amount = fromStripeCents(refund.amount, currency);
      const refundPaymentId = await ensureRefundPaymentRecord(tx, {
        originalPaymentId: paymentId,
        stripeRefundId: refund.id,
        amount,
        grossMinor: refund.amount,
        currency,
        type: operation?.refundType ?? refundTypeOf(payment.type),
        notes: operation?.notes ?? null,
        paidAt: new Date(refund.created * 1000),
      });
      rows.push({ refundId: refund.id, refundPaymentId, amount });

      if (
        operation &&
        (operation.status !== "succeeded" || operation.refundPaymentId !== refundPaymentId)
      ) {
        if (refund.amount !== operation.amountMinor) {
          log.error({
            stripeRefund: {
              issue: "refund_amount_differs",
              operationId: operation.id,
              refundId: refund.id,
              operationMinor: operation.amountMinor,
              refundMinor: refund.amount,
            },
          });
        }
        await tx
          .update(paymentRefundOperations)
          .set({
            status: "succeeded",
            stripeRefundId: refund.id,
            refundPaymentId,
            failureCode: null,
            failureMessage: null,
            claimToken: null,
            claimedUntil: null,
            updatedAt: sql`NOW()`,
          })
          .where(eq(paymentRefundOperations.id, operation.id));
        await tx.insert(reservationActivity).values({
          id: nanoid(),
          reservationId: input.reservationId,
          activityType: "payment_updated",
          metadata: {
            refundOperationId: operation.id,
            paymentId: refundPaymentId,
            refundId: refund.id,
            amount,
            currency,
          },
          createdAt: new Date(),
        });
        settledOperationIds.push(operation.id);
      }
    }

    // What came off the charge: every refund that moved money, listed or recorded.
    const listed = new Map(input.refunds.map((refund) => [refund.id, refund]));
    const recorded = await tx
      .select({ refundId: payments.stripeRefundId, grossMinor: payments.grossMinor })
      .from(payments)
      .where(
        and(
          eq(payments.refundOfPaymentId, paymentId),
          eq(payments.status, "completed"),
          isStripeRefundPaymentSql(),
        ),
      );
    let refundedMinor = 0;
    for (const refund of input.refunds)
      if (refundMovedMoney(refund)) refundedMinor += refund.amount;
    for (const row of recorded) {
      if (!row.refundId || listed.has(row.refundId) || row.grossMinor === null) continue;
      refundedMinor += row.grossMinor;
    }
    const netMinor = Math.max(0, input.amountCapturedMinor - refundedMinor);
    await tx
      .update(payments)
      .set({
        amount: fromStripeCents(netMinor, currency).toFixed(2),
        status: netMinor > 0 ? "completed" : "refunded",
        stripeChargeId: sql`COALESCE(${payments.stripeChargeId}, ${chargeId})`,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
    await markReservationIds(tx, [input.reservationId]);

    return { rows, netMinor, settledOperationIds };
  }, REFUND_TRANSACTION);
}

/**
 * The credit note of each refund row, after the commit: one per refund row
 * (`generateCreditNoteForRefund` links it to the row, and skips a row already linked).
 */
export async function issueRefundCreditNotes(
  originalPaymentId: string,
  rows: readonly RecordedRefundRow[],
  source: string,
): Promise<void> {
  for (const row of rows) {
    await tryGenerateCreditNoteForRefund(
      { originalPaymentId, refundPaymentId: row.refundPaymentId },
      row.amount,
      source,
    );
  }
}

/**
 * Records that a refund failed or was canceled after Stripe made it (`refund.failed`,
 * `refund.updated`, `charge.refund.updated`): the operation it answers is `failed`
 * with Stripe's reason. A refund of no operation, or of an operation on another
 * account, changes nothing. The refund row already written for it, if any, stays as it
 * was: see docs/domain/reservation-invariants.md, M8.
 */
export async function recordRefundFailure(
  database: Database,
  input: { readonly accountId: string; readonly refund: ProviderRefund },
): Promise<{ readonly operationId: string; readonly hadRefundRow: boolean } | null> {
  const { refund } = input;
  if (refundMovedMoney(refund)) return null;
  const match = [
    eq(paymentRefundOperations.stripeRefundId, refund.id),
    ...(refund.operationId ? [eq(paymentRefundOperations.id, refund.operationId)] : []),
  ];
  const [found] = await database
    .select({
      id: paymentRefundOperations.id,
      reservationId: paymentRefundOperations.reservationId,
    })
    .from(paymentRefundOperations)
    .where(or(...match))
    .limit(1);
  if (!found) return null;

  return database.transaction(async (tx) => {
    if (!(await lockRefundReservation(tx, found.reservationId))) return null;
    const [operation] = await tx
      .select({
        status: paymentRefundOperations.status,
        accountId: paymentRefundOperations.stripeAccountId,
        stripeRefundId: paymentRefundOperations.stripeRefundId,
        refundPaymentId: paymentRefundOperations.refundPaymentId,
      })
      .from(paymentRefundOperations)
      .where(eq(paymentRefundOperations.id, found.id))
      .for("update");
    if (!operation || operation.accountId !== input.accountId) return null;
    // An operation answered by another refund is not this one's.
    if (operation.stripeRefundId !== null && operation.stripeRefundId !== refund.id) return null;
    if (operation.status !== "failed") {
      await tx
        .update(paymentRefundOperations)
        .set({
          status: "failed",
          stripeRefundId: refund.id,
          failureCode: (refund.failureReason ?? refund.status ?? "failed").slice(0, 64),
          failureMessage: null,
          claimToken: null,
          claimedUntil: null,
          updatedAt: sql`NOW()`,
        })
        .where(eq(paymentRefundOperations.id, found.id));
    }
    return { operationId: found.id, hadRefundRow: operation.refundPaymentId !== null };
  }, REFUND_TRANSACTION);
}

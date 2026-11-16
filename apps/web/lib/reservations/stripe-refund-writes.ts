import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type Database,
  type Transaction,
  isPaymentReceiptSql,
  isStripeRefundPaymentSql,
  markReservationIds,
  paymentRefundOperations,
  payments,
  reservationActivity,
  reservations,
} from "@louez/db";

import { enqueueEffects } from "@louez/api/platform/effects";

import { log } from "@/lib/evlog";
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
  /**
   * `failed` for a refund Stripe reports failed or canceled before Louez wrote its row:
   * the row keeps that fact under the refund's id, and counts for nothing.
   */
  status?: "completed" | "failed";
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

  // A row that is a refund (`isStripeRefundPaymentSql`), never the original payment the
  // oldest webhooks stamped with the refund's id.
  const existingRefund = await tx.query.payments.findFirst({
    where: and(
      eq(payments.reservationId, originalPayment.reservationId),
      eq(payments.stripeRefundId, input.stripeRefundId),
      isStripeRefundPaymentSql(),
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
    status: input.status ?? "completed",
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

/**
 * The activity line of a refund row undone because Stripe reports its refund failed
 * or canceled (`metadata.kind`); the inbox's `refund_undone` reads it (packages/api
 * services/inbox.ts).
 */
export const REFUND_UNDONE_ACTIVITY = "refund_undone";

/**
 * The activity line of a refund Louez holds as failed that Stripe then listed as moving
 * money (`metadata.kind`): Louez keeps it failed, and the inbox's `refund_undone` asks a
 * person to look at it in Stripe.
 */
export const REFUND_FAILED_LISTED_ACTIVITY = "refund_failed_listed";

/**
 * The activity line of the application fee Louez gave back on a refund that failed
 * afterwards (`metadata.kind`): Stripe cannot take an application fee refund back, so
 * it stays given back; the inbox's `refund_undone` names it.
 */
export const REFUND_FEE_OVER_RETURNED_ACTIVITY = "refund_fee_over_returned";

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
  /**
   * The refund rows this write undid: recorded `completed`, for a refund Stripe now
   * reports failed or canceled. Each is `failed` now.
   */
  readonly undone: readonly RecordedRefundRow[];
  /** What the store keeps of the charge. */
  readonly netMinor: number;
  /** The credit notes owed for the rows written now: hand them to the dispatcher. */
  readonly effectIds: readonly string[];
  /** The operations this write settled, `succeeded` or `failed`. */
  readonly settledOperationIds: readonly string[];
};

/**
 * Writes what Stripe lists of a charge's refunds on the payment that holds its money.
 *
 * The payment is brought down to what the store keeps: the charge's captured amount
 * less every refund whose row is `completed` once this listing is merged in, each
 * counted once by its refund id. The figure comes from the rows, never from the listing
 * alone, so a listing older than what was recorded never moves the payment. Only
 * `amount` is netted: `gross_minor` keeps the charge amount (billing README Q7). A
 * payment found through its PaymentIntent gets the charge id it lacked (Q36).
 *
 * A refund whose metadata names an operation, or the refund an operation already
 * names, settles that operation in the same transaction: `succeeded` with its refund
 * and its row when it moved money, `failed` with Stripe's reason otherwise. An
 * operation of another payment or charge is left alone (its id was put on a refund by
 * hand); a refund that names none is recorded as every refund made in Stripe's
 * dashboard always was.
 *
 * What Louez records follows Stripe's final word, and never goes backwards: a refund
 * Stripe reports failed or canceled has a `failed` row under its id, the row written for
 * it made `failed` (an activity line names it) or, when none was written yet, a row
 * written `failed` that counts for nothing and owes no credit note; its operation is
 * `failed`. A failed refund is final at Stripe and in Louez: a `failed` row is never made
 * `completed` again, and a listing that shows it moving money changes nothing but an
 * activity line, once, for a person to look at.
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
    /** Who heard it, for the invoicing log of each credit note. */
    readonly source: string;
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
    // Every payment row of the reservation that holds this charge's money, locked by id:
    // a refund is reconciled on the row its operation or its own row names, whichever row
    // the event resolved to.
    const siblings = await tx
      .select({
        id: payments.id,
        type: payments.type,
        stampedRefundId: payments.stripeRefundId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, input.reservationId),
          or(eq(payments.id, paymentId), eq(payments.stripeChargeId, chargeId)),
          eq(payments.method, "stripe"),
          sql`${payments.type} <> 'deposit_hold'`,
          isPaymentReceiptSql(),
        ),
      )
      .orderBy(asc(payments.id))
      .for("update");
    const siblingIds = new Set(siblings.map((row) => row.id));
    /** The payment row the oldest webhooks stamped with this refund's id, if any. */
    const stampedOn = (refundId: string) =>
      siblings.find((row) => row.stampedRefundId === refundId)?.id ?? null;
    const typeOf = (id: string) => siblings.find((row) => row.id === id)?.type ?? payment.type;
    // The rows already written for these refunds, after the payment's.
    const existingRows =
      refundIds.length > 0
        ? await tx
            .select({
              id: payments.id,
              refundId: payments.stripeRefundId,
              status: payments.status,
              amount: payments.amount,
              refundOf: payments.refundOfPaymentId,
            })
            .from(payments)
            .where(
              and(
                eq(payments.reservationId, input.reservationId),
                inArray(payments.stripeRefundId, refundIds),
                isStripeRefundPaymentSql(),
              ),
            )
            .orderBy(asc(payments.id))
            .for("update")
        : [];
    const rowOf = (refund: ProviderRefund) =>
      existingRows.find((row) => row.refundId === refund.id) ?? null;

    // An operation of another payment or charge is never settled from this charge:
    // its id was put on a refund by hand.
    const ours = operations.filter(
      (operation) => siblingIds.has(operation.paymentId) && operation.chargeId === chargeId,
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
    const undone: RecordedRefundRow[] = [];
    const effectIds: string[] = [];
    const settledOperationIds: string[] = [];
    /** The payment row a refund gives money back from: its row's, its operation's, the one stamped with it, or the event's. */
    const originalOf = (
      refund: ProviderRefund,
      operation: (typeof ours)[number] | null,
      existing: (typeof existingRows)[number] | null,
    ) =>
      (existing?.refundOf && siblingIds.has(existing.refundOf) ? existing.refundOf : null) ??
      operation?.paymentId ??
      stampedOn(refund.id) ??
      paymentId;
    for (const refund of input.refunds) {
      const operation = operationOf(refund);
      const existing = rowOf(refund);
      const original = originalOf(refund, operation, existing);
      // A failed refund is final in Louez: a listing that shows it moving money, older
      // or not, changes nothing, and is named once for a person to look at.
      if (refundMovedMoney(refund) && existing?.status === "failed") {
        log.error({
          stripeRefund: { issue: "failed_refund_listed_as_moving_money", refundId: refund.id },
        });
        const [named] = await tx
          .select({ id: reservationActivity.id })
          .from(reservationActivity)
          .where(
            and(
              eq(reservationActivity.reservationId, input.reservationId),
              sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.kind')) = ${REFUND_FAILED_LISTED_ACTIVITY}`,
              sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.refundId')) = ${refund.id}`,
            ),
          )
          .limit(1);
        if (!named) {
          await tx.insert(reservationActivity).values({
            id: nanoid(),
            reservationId: input.reservationId,
            activityType: "payment_updated",
            metadata: {
              kind: REFUND_FAILED_LISTED_ACTIVITY,
              paymentId: existing.id,
              refundOfPaymentId: original,
              refundId: refund.id,
              refundStatus: refund.status,
            },
            createdAt: new Date(),
          });
        }
        continue;
      }
      if (!refundMovedMoney(refund)) {
        if (existing?.status === "completed") {
          await tx
            .update(payments)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(payments.id, existing.id));
          const amount = Number(existing.amount);
          undone.push({ refundId: refund.id, refundPaymentId: existing.id, amount });
          await tx.insert(reservationActivity).values({
            id: nanoid(),
            reservationId: input.reservationId,
            activityType: "payment_updated",
            metadata: {
              kind: REFUND_UNDONE_ACTIVITY,
              paymentId: existing.id,
              refundOfPaymentId: original,
              refundId: refund.id,
              refundStatus: refund.status,
              amount,
              currency,
            },
            createdAt: new Date(),
          });
        }
        if (!existing) {
          // Failed before Louez wrote a row of its own (also a refund the oldest webhooks
          // only stamped on its payment): the fact is kept under its id, in a row linked to
          // that payment, so an older listing that still shows it moving money never
          // counts it again. The stamped payment itself is left as it is.
          await ensureRefundPaymentRecord(tx, {
            originalPaymentId: original,
            stripeRefundId: refund.id,
            amount: fromStripeCents(refund.amount, currency),
            grossMinor: refund.amount,
            currency,
            type: operation?.refundType ?? refundTypeOf(typeOf(original)),
            notes: operation?.notes ?? null,
            paidAt: new Date(refund.created * 1000),
            status: "failed",
          });
        }
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

      // A refund the oldest webhooks stamped on its payment, with no row of its own: left
      // as it was recorded, counted as Stripe lists it.
      if (!existing && stampedOn(refund.id)) continue;
      const amount = fromStripeCents(refund.amount, currency);
      const refundPaymentId = await ensureRefundPaymentRecord(tx, {
        originalPaymentId: original,
        stripeRefundId: refund.id,
        amount,
        grossMinor: refund.amount,
        currency,
        type: operation?.refundType ?? refundTypeOf(typeOf(original)),
        notes: operation?.notes ?? null,
        paidAt: new Date(refund.created * 1000),
      });
      rows.push({ refundId: refund.id, refundPaymentId, amount });
      // Its credit note is owed from the transaction that writes the row.
      if (!existing) {
        effectIds.push(
          ...(await enqueueEffects(tx, reservation.storeId, [
            {
              type: "payment.refundCreditNote",
              reservationId: input.reservationId,
              payload: {
                storeId: reservation.storeId,
                reservationId: input.reservationId,
                paymentId: original,
                refundId: refundPaymentId,
                amount: amount.toFixed(2),
                source: input.source,
              },
            },
          ])),
        );
      }

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

    // What came off the charge, from the rows after this merge, on each of its payment
    // rows: each refund once, by its id, counted while its row of its own is `completed`,
    // on the row it gives money back from. A refund with no row of its own (one the
    // oldest webhooks stamped on its payment) counts as Stripe lists it. So a listing
    // applied after a newer one changes nothing.
    const listed = new Map(input.refunds.map((refund) => [refund.id, refund]));
    const recorded = await tx
      .select({
        refundId: payments.stripeRefundId,
        status: payments.status,
        grossMinor: payments.grossMinor,
        amount: payments.amount,
        refundOf: payments.refundOfPaymentId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, input.reservationId),
          isStripeRefundPaymentSql(),
          or(
            inArray(payments.refundOfPaymentId, [...siblingIds]),
            ...(refundIds.length > 0 ? [inArray(payments.stripeRefundId, refundIds)] : []),
          ),
        ),
      );
    const refundedOf = new Map<string, number>([[paymentId, 0]]);
    const add = (id: string, minor: number) =>
      refundedOf.set(id, (refundedOf.get(id) ?? 0) + minor);
    const recordedIds = new Set<string>();
    for (const row of recorded) {
      if (!row.refundId || recordedIds.has(row.refundId)) continue;
      recordedIds.add(row.refundId);
      // An older refund row with no link gives back the payment the event names.
      const of = row.refundOf && siblingIds.has(row.refundOf) ? row.refundOf : paymentId;
      add(of, 0);
      if (row.status !== "completed") continue;
      const minor =
        row.grossMinor ?? listed.get(row.refundId)?.amount ?? grossMinorOf(row.amount, currency);
      if (minor !== null) add(of, minor);
    }
    for (const refund of input.refunds) {
      if (recordedIds.has(refund.id) || !refundMovedMoney(refund)) continue;
      add(originalOf(refund, operationOf(refund), null), refund.amount);
    }
    let netMinor = 0;
    for (const [id, refundedMinor] of refundedOf) {
      const net = Math.max(0, input.amountCapturedMinor - refundedMinor);
      if (id === paymentId) netMinor = net;
      await tx
        .update(payments)
        .set({
          amount: fromStripeCents(net, currency).toFixed(2),
          status: net > 0 ? "completed" : "refunded",
          stripeChargeId: sql`COALESCE(${payments.stripeChargeId}, ${chargeId})`,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, id));
    }
    await markReservationIds(tx, [input.reservationId]);

    return { rows, undone, netMinor, effectIds, settledOperationIds };
  }, REFUND_TRANSACTION);
}

/**
 * Records the application fee Louez gave back on refunds that failed afterwards: Stripe
 * cannot take an application fee refund back, so what was given back past the fee's
 * share of what the store still does not keep stays given back. One record per charge's
 * fee, on one activity line, named on the charge's latest undone refund row, where the
 * inbox's `refund_undone` shows it. Its figure is the charge's state as of the newest
 * reading of it (`readAt`, taken under the charge's lock by `reverseFeeAtSource`):
 *
 * - a reading older than the one recorded changes nothing, whichever is recorded first;
 * - a newer one replaces it, down to zero when refunds that stand since justify all the
 *   fee given back (a zero is no inbox item);
 * - other lines of the same fee are folded into the one kept (the oldest).
 */
export async function recordFeeOverReturned(
  database: Database,
  input: {
    readonly reservationId: string;
    readonly paymentId: string;
    readonly chargeId: string;
    readonly fee: {
      readonly feeId: string;
      readonly targetMinor: number;
      readonly feeRefundedMinor: number;
      readonly readAt: string;
    } | null;
  },
): Promise<boolean> {
  const { fee } = input;
  if (!fee) return false;
  const overReturnedMinor = Math.max(0, fee.feeRefundedMinor - fee.targetMinor);
  return database.transaction(async (tx) => {
    if (!(await lockRefundReservation(tx, input.reservationId))) return false;
    const lines = await tx
      .select({ id: reservationActivity.id, metadata: reservationActivity.metadata })
      .from(reservationActivity)
      .where(
        and(
          eq(reservationActivity.reservationId, input.reservationId),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.kind')) = ${REFUND_FEE_OVER_RETURNED_ACTIVITY}`,
          sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.feeId')) = ${fee.feeId}`,
        ),
      )
      .orderBy(asc(reservationActivity.id))
      .for("update");
    const [line, ...folded] = lines;
    if (folded.length > 0) {
      await tx.delete(reservationActivity).where(
        inArray(
          reservationActivity.id,
          folded.map((row) => row.id),
        ),
      );
    }
    const current = (line?.metadata ?? {}) as {
      paymentId?: unknown;
      overReturnedMinor?: unknown;
      readAt?: unknown;
    };
    // A reading older than the one recorded: the charge has moved on since.
    if (typeof current.readAt === "string" && current.readAt > fee.readAt) {
      return folded.length > 0;
    }
    if (!line && overReturnedMinor === 0) return false;

    let undoneId = typeof current.paymentId === "string" ? current.paymentId : null;
    if (overReturnedMinor > 0) {
      // The charge's payment rows of the reservation, as the writer reconciles them.
      const siblings = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, input.reservationId),
            or(eq(payments.id, input.paymentId), eq(payments.stripeChargeId, input.chargeId)),
            isPaymentReceiptSql(),
          ),
        );
      // A failed refund row of the charge: linked to one of them, or, older, with no
      // link and the charge's id.
      const [undone] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.reservationId, input.reservationId),
            eq(payments.status, "failed"),
            isStripeRefundPaymentSql(),
            or(
              inArray(
                payments.refundOfPaymentId,
                siblings.map((row) => row.id),
              ),
              and(
                sql`${payments.refundOfPaymentId} IS NULL`,
                eq(payments.stripeChargeId, input.chargeId),
              ),
            ),
          ),
        )
        .orderBy(desc(payments.updatedAt), desc(payments.id))
        .limit(1);
      if (undone) undoneId = undone.id;
    }
    if (!undoneId) return folded.length > 0;
    const metadata = {
      kind: REFUND_FEE_OVER_RETURNED_ACTIVITY,
      paymentId: undoneId,
      refundOfPaymentId: input.paymentId,
      feeId: fee.feeId,
      overReturnedMinor,
      readAt: fee.readAt,
    };
    if (line) {
      if (
        current.overReturnedMinor === overReturnedMinor &&
        current.paymentId === undoneId &&
        current.readAt === fee.readAt
      ) {
        return folded.length > 0;
      }
      await tx
        .update(reservationActivity)
        .set({ metadata })
        .where(eq(reservationActivity.id, line.id));
    } else {
      await tx.insert(reservationActivity).values({
        id: nanoid(),
        reservationId: input.reservationId,
        activityType: "payment_updated",
        metadata,
        createdAt: new Date(),
      });
    }
    if (overReturnedMinor > 0 && current.overReturnedMinor !== overReturnedMinor) {
      log.error({
        stripeRefund: {
          issue: "fee_over_returned",
          feeId: fee.feeId,
          refundPaymentId: undoneId,
          overReturnedMinor,
        },
      });
    }
    return true;
  }, REFUND_TRANSACTION);
}

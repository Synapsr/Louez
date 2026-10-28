import { type SQL, and, eq, isNull, ne, or, sql } from "drizzle-orm";

import { db, isPaymentReceiptSql, markReservation, markReservationIds } from "@louez/db";
import { paymentDisputes, payments, reservations, stores } from "@louez/db";

import { log } from "@/lib/evlog";
import { fromStripeCents } from "@/lib/stripe";

import {
  type DisputeEventType,
  type DisputeInput,
  mergeDispute,
  readDisputeFacts,
} from "./dispute-facts";

// The Connect webhook's writes to a charge's payment and its disputes, each in one
// transaction with the reservation's billing mark (louez-billing docs/api, §5.2).

/**
 * Brings the payment down to what the store keeps, `netMinor`: the charge's captured
 * amount less its refunds, read from Stripe, never from the event (Stripe does not
 * order events). Only `amount` is netted: `gross_minor` keeps the charge amount
 * (README Q7). A payment found through its PaymentIntent gets the charge id it lacked
 * (README Q36).
 */
export async function netRefundedChargePayment(input: {
  readonly paymentId: string;
  readonly reservationId: string;
  readonly chargeId: string;
  /** Upper case. */
  readonly currency: string;
  readonly netMinor: number;
}): Promise<void> {
  const netAmount = fromStripeCents(input.netMinor, input.currency);
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({
        amount: netAmount.toFixed(2),
        status: input.netMinor > 0 ? "completed" : "refunded",
        stripeChargeId: sql`COALESCE(${payments.stripeChargeId}, ${input.chargeId})`,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, input.paymentId));
    await markReservationIds(tx, [input.reservationId]);
  });
}

/**
 * The payment was taken on this connected account, or, for rows written before
 * payments had one, its store is on it. Joins `reservations` and `stores`.
 */
const paymentOnAccount = (accountId: string) =>
  or(
    eq(payments.stripeAccountId, accountId),
    and(isNull(payments.stripeAccountId), eq(stores.stripeAccountId, accountId)),
  );

export type ChargePayment = {
  readonly paymentId: string;
  readonly reservationId: string;
  readonly storeId: string;
  readonly type: (typeof payments.$inferSelect)["type"];
  readonly stripePaymentIntentId: string | null;
};

/**
 * The payment that holds a charge's money, on the connected account that sent the
 * event: the row with the charge id, else, for a row without one, the row with the
 * PaymentIntent. Refund rows are skipped, but not a charge that older webhooks
 * stamped with its refund id (README Q7, shape 1). A deposit's hold shares its
 * PaymentIntent with its capture; the money is the capture.
 */
export async function findChargePayment(input: {
  readonly chargeId: string;
  readonly paymentIntentId: string | null;
  readonly accountId: string;
}): Promise<ChargePayment | null> {
  const onAccount = paymentOnAccount(input.accountId);
  const find = (match: SQL | undefined) =>
    db
      .select({
        paymentId: payments.id,
        reservationId: payments.reservationId,
        storeId: reservations.storeId,
        type: payments.type,
        stripePaymentIntentId: payments.stripePaymentIntentId,
      })
      .from(payments)
      .innerJoin(reservations, eq(reservations.id, payments.reservationId))
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(and(match, isPaymentReceiptSql(), onAccount))
      .limit(1);

  const [byCharge] = await find(eq(payments.stripeChargeId, input.chargeId));
  if (byCharge) return byCharge;
  if (!input.paymentIntentId) return null;
  const [byIntent] = await find(
    and(
      eq(payments.stripePaymentIntentId, input.paymentIntentId),
      isNull(payments.stripeChargeId),
      ne(payments.type, "deposit_hold"),
    ),
  );
  return byIntent ?? null;
}

/**
 * Whether a charge Louez found no payment for belongs to a Louez reservation on that
 * account: a payment row carries its PaymentIntent, or the reservation id in its Stripe
 * metadata is a reservation of a store on it. Its payment may not be written yet (the
 * checkout completes after the refund event), so the webhook answers 500 and Stripe
 * retries for three days instead of dropping the event.
 */
export async function isKnownPaymentIntent(input: {
  readonly paymentIntentId: string | null;
  readonly accountId: string;
  /** The reservation id of the Stripe metadata, read only when no payment matched. */
  readonly readReservationId: () => Promise<string | null>;
}): Promise<boolean> {
  if (input.paymentIntentId) {
    const [payment] = await db
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(reservations, eq(reservations.id, payments.reservationId))
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(
        and(
          eq(payments.stripePaymentIntentId, input.paymentIntentId),
          paymentOnAccount(input.accountId),
        ),
      )
      .limit(1);
    if (payment) return true;
  }
  const reservationId = await input.readReservationId();
  if (!reservationId) return false;
  const [reservation] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(and(eq(reservations.id, reservationId), eq(stores.stripeAccountId, input.accountId)))
    .limit(1);
  return reservation !== undefined;
}

export type RecordDisputeResult =
  | { readonly recorded: true; readonly paymentId: string; readonly reservationId: string }
  | { readonly recorded: false; readonly reason: "missing_account" | "payment_not_found" };

/** Upserts the `payment_disputes` row of a `charge.dispute.*` event (README Q15). */
export async function recordChargeDispute(input: {
  readonly dispute: DisputeInput;
  readonly eventType: DisputeEventType;
  readonly eventCreatedAt: Date;
  readonly accountId: string | undefined;
}): Promise<RecordDisputeResult> {
  const facts = readDisputeFacts(input);
  if (!facts.knownStatus) {
    log.error(
      "billing",
      `unknown Stripe dispute status "${facts.stripeStatus}" on ${facts.disputeId}: counted as open`,
    );
  }
  if (!input.accountId) return { recorded: false, reason: "missing_account" };

  const payment = await findChargePayment({
    chargeId: facts.chargeId,
    paymentIntentId: facts.paymentIntentId,
    accountId: input.accountId,
  });
  if (!payment) return { recorded: false, reason: "payment_not_found" };

  await db.transaction(async (tx) => {
    const first = mergeDispute(null, facts);
    // Insert first, so two events of one dispute delivered together queue on the
    // row lock instead of both inserting.
    await tx
      .insert(paymentDisputes)
      .values({
        id: facts.disputeId,
        paymentId: payment.paymentId,
        reservationId: payment.reservationId,
        ...first,
      })
      .onDuplicateKeyUpdate({ set: { id: facts.disputeId } });
    const [stored] = await tx
      .select({
        status: paymentDisputes.status,
        stripeStatus: paymentDisputes.stripeStatus,
        openedAt: paymentDisputes.openedAt,
        closedAt: paymentDisputes.closedAt,
      })
      .from(paymentDisputes)
      .where(eq(paymentDisputes.id, facts.disputeId))
      .for("update");
    await tx
      .update(paymentDisputes)
      .set({ ...mergeDispute(stored ?? null, facts), updatedAt: new Date() })
      .where(eq(paymentDisputes.id, facts.disputeId));
    await markReservation(tx, { id: payment.reservationId, storeId: payment.storeId });
  });
  return { recorded: true, paymentId: payment.paymentId, reservationId: payment.reservationId };
}

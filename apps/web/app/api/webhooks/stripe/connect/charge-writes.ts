import { type SQL, and, eq, isNull, ne, or } from "drizzle-orm";
import type Stripe from "stripe";

import { db, markReservation, markReservationIds } from "@louez/db";
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

export type RefundedCharge = Pick<
  Stripe.Charge,
  "amount" | "amount_refunded" | "refunded" | "currency"
>;

/**
 * Brings the payment down to what the store keeps. Only `amount` is netted:
 * `gross_minor` keeps the charge amount (README Q7).
 */
export async function netRefundedChargePayment(input: {
  readonly paymentId: string;
  readonly reservationId: string;
  readonly charge: RefundedCharge;
}): Promise<void> {
  const { charge } = input;
  const currency = charge.currency.toUpperCase();
  const netAmount = fromStripeCents(Math.max(0, charge.amount - charge.amount_refunded), currency);
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({
        amount: netAmount.toFixed(2),
        status: charge.refunded ? "refunded" : "completed",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, input.paymentId));
    await markReservationIds(tx, [input.reservationId]);
  });
}

type DisputedPayment = {
  readonly paymentId: string;
  readonly reservationId: string;
  readonly storeId: string;
};

/**
 * The payment a dispute is about, on the connected account that sent the event.
 * A payment without a charge id is found through its PaymentIntent.
 */
async function findDisputedPayment(input: {
  readonly chargeId: string;
  readonly paymentIntentId: string | null;
  readonly accountId: string;
}): Promise<DisputedPayment | null> {
  // The account that took the charge, or the store's for rows written before
  // payments had one.
  const onAccount = or(
    eq(payments.stripeAccountId, input.accountId),
    and(isNull(payments.stripeAccountId), eq(stores.stripeAccountId, input.accountId)),
  );
  const find = (match: SQL | undefined) =>
    db
      .select({
        paymentId: payments.id,
        reservationId: payments.reservationId,
        storeId: reservations.storeId,
      })
      .from(payments)
      .innerJoin(reservations, eq(reservations.id, payments.reservationId))
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(and(match, isNull(payments.stripeRefundId), onAccount))
      .limit(1);

  const [byCharge] = await find(eq(payments.stripeChargeId, input.chargeId));
  if (byCharge) return byCharge;
  if (!input.paymentIntentId) return null;
  // A deposit's hold and capture share the PaymentIntent; the money is the capture.
  const [byIntent] = await find(
    and(
      eq(payments.stripePaymentIntentId, input.paymentIntentId),
      isNull(payments.stripeChargeId),
      ne(payments.type, "deposit_hold"),
    ),
  );
  return byIntent ?? null;
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

  const payment = await findDisputedPayment({
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

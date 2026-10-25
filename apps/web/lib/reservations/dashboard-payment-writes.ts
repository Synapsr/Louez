import { and, eq } from "drizzle-orm";

import {
  type Database,
  type Transaction,
  markReservation,
  payments,
  reservationItems,
  reservations,
} from "@louez/db";
import type { StoreSettings } from "@louez/types";

import type { ReservationTotalsInput } from "@/lib/billing-sync/money";
import {
  type RecordedPaymentType,
  grossMinorOf,
  recordedPaymentFacts,
  reservationCurrency,
} from "@/lib/reservations/payment-billing-facts";

// The payment writes of the dashboard's reservation actions, which the assistant's
// payment tools share. Each one writes its rows and marks the reservation for the
// billing service in one transaction (louez-billing docs/api, README §5.2). Stripe
// calls stay with the caller, before the transaction.

type TotalsSettings = Pick<StoreSettings, "currency" | "tax"> | null;
type RecordedPaymentMethod = "cash" | "card" | "transfer" | "check" | "other";
type ReservationRef = { readonly reservationId: string; readonly storeId: string };

async function loadTotalsInput(
  tx: Transaction,
  ref: ReservationRef,
  storeSettings: TotalsSettings,
  withItems: boolean,
): Promise<ReservationTotalsInput> {
  const [reservation] = await tx
    .select({
      createdAt: reservations.createdAt,
      currency: reservations.currency,
      totalAmount: reservations.totalAmount,
      subtotalAmount: reservations.subtotalAmount,
      depositAmount: reservations.depositAmount,
      tulipInsuranceAmount: reservations.tulipInsuranceAmount,
    })
    .from(reservations)
    .where(and(eq(reservations.id, ref.reservationId), eq(reservations.storeId, ref.storeId)));
  if (!reservation) throw new Error("errors.reservationNotFound");

  const items = withItems
    ? await tx
        .select({
          productId: reservationItems.productId,
          taxRate: reservationItems.taxRate,
          totalPrice: reservationItems.totalPrice,
        })
        .from(reservationItems)
        .where(eq(reservationItems.reservationId, ref.reservationId))
    : [];
  return { reservation, storeSettings, items };
}

export type RecordedPaymentInput = ReservationRef & {
  readonly id: string;
  readonly storeSettings: TotalsSettings;
  readonly type: RecordedPaymentType;
  readonly method: RecordedPaymentMethod;
  /** As stored, `decimal(10,2)`. */
  readonly amount: string;
  /** `deposit` for a deposit given back, `manual` otherwise. */
  readonly origin: "manual" | "deposit";
  readonly paidAt: Date;
  readonly notes: string | null;
};

/**
 * Inserts a payment the store records by hand, in the reservation's currency
 * rather than the column's EUR default (contract Q4), with its billing facts.
 */
export async function insertRecordedPayment(
  tx: Transaction,
  input: RecordedPaymentInput,
): Promise<void> {
  const totals = await loadTotalsInput(tx, input, input.storeSettings, input.type === "rental");
  const facts = recordedPaymentFacts({ type: input.type, amount: input.amount, totals });
  await tx.insert(payments).values({
    id: input.id,
    reservationId: input.reservationId,
    amount: input.amount,
    type: input.type,
    method: input.method,
    status: "completed",
    paidAt: input.paidAt,
    notes: input.notes,
    currency: facts.currency,
    grossMinor: facts.grossMinor,
    insuranceShareMinor: facts.insuranceShareMinor,
    origin: input.origin,
  });
  await markReservation(tx, { id: input.reservationId, storeId: input.storeId });
}

export type ManualRefundInput = ReservationRef & {
  readonly id: string;
  readonly storeSettings: TotalsSettings;
  readonly reservationCurrency: string | null;
  readonly original: {
    readonly id: string;
    readonly method: string;
    readonly currency: string | null;
  };
  readonly type: "rental" | "deposit_return";
  readonly method: RecordedPaymentMethod;
  readonly amount: string;
  readonly paidAt: Date;
  readonly notes: string | null;
};

/**
 * Inserts a refund the store gives by hand. It is folded onto the payment it
 * refunds and never sent as a payment, so it has no insurance share. Its currency
 * is the payment's: the charge currency for a Stripe payment, else the
 * reservation's, since older manual rows hold the EUR default (contract Q4).
 */
export async function insertManualRefund(tx: Transaction, input: ManualRefundInput): Promise<void> {
  const currency =
    input.original.method === "stripe" && input.original.currency
      ? input.original.currency
      : reservationCurrency(input.reservationCurrency, input.storeSettings);
  await tx.insert(payments).values({
    id: input.id,
    reservationId: input.reservationId,
    amount: input.amount,
    type: input.type,
    method: input.method,
    status: "completed",
    refundOfPaymentId: input.original.id,
    currency,
    grossMinor: grossMinorOf(input.amount, currency),
    insuranceShareMinor: 0,
    origin: "manual",
    notes: input.notes,
    paidAt: input.paidAt,
    createdAt: input.paidAt,
    updatedAt: input.paidAt,
  });
  await markReservation(tx, { id: input.reservationId, storeId: input.storeId });
}

/** Deletes a recorded payment; its lines go back to 0 in the service (fees.md §10.1). */
export async function deleteRecordedPayment(
  database: Database,
  input: ReservationRef & { readonly paymentId: string },
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .delete(payments)
      .where(
        and(eq(payments.id, input.paymentId), eq(payments.reservationId, input.reservationId)),
      );
    await markReservation(tx, { id: input.reservationId, storeId: input.storeId });
  });
}

export type DepositHoldInput = ReservationRef & {
  readonly paymentId: string;
  readonly stripeAccountId: string;
  readonly paymentIntentId: string;
  readonly paymentMethodId: string;
  readonly expiresAt: Date;
  readonly amount: string;
  /** The amount sent to Stripe. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly now: Date;
};

/** Records an authorized deposit hold on the reservation and as a payment. */
export async function recordDepositHold(
  database: Database,
  input: DepositHoldInput,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({
        depositStatus: "authorized",
        depositPaymentIntentId: input.paymentIntentId,
        depositAuthorizationExpiresAt: input.expiresAt,
        updatedAt: input.now,
      })
      .where(
        and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)),
      );

    await tx.insert(payments).values({
      id: input.paymentId,
      reservationId: input.reservationId,
      amount: input.amount,
      type: "deposit_hold",
      method: "stripe",
      status: "authorized",
      stripePaymentIntentId: input.paymentIntentId,
      stripePaymentMethodId: input.paymentMethodId,
      stripeAccountId: input.stripeAccountId,
      authorizationExpiresAt: input.expiresAt,
      currency: input.currency,
      grossMinor: input.amountMinor,
      insuranceShareMinor: 0,
      origin: "deposit",
      createdAt: input.now,
      updatedAt: input.now,
    });
    await markReservation(tx, { id: input.reservationId, storeId: input.storeId });
  });
}

/** The reservation's authorized hold, locked. */
async function lockAuthorizedHold(tx: Transaction, reservationId: string) {
  const [hold] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservationId),
        eq(payments.type, "deposit_hold"),
        eq(payments.status, "authorized"),
      ),
    )
    .limit(1)
    .for("update");
  return hold ?? null;
}

export type DepositCaptureInput = ReservationRef & {
  readonly capturePaymentId: string;
  readonly stripeAccountId: string;
  readonly paymentIntentId: string;
  /** The PaymentIntent's latest charge, which the service matches application fees on. */
  readonly stripeChargeId: string | null;
  readonly amount: string;
  /** What Stripe captured, `amount_received`. */
  readonly capturedMinor: number;
  /** The PaymentIntent's currency. */
  readonly currency: string;
  readonly reason: string;
  readonly now: Date;
};

/** Records a captured deposit: the hold completes and a deposit_capture row holds the money. */
export async function recordDepositCapture(
  database: Database,
  input: DepositCaptureInput,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ depositStatus: "captured", updatedAt: input.now })
      .where(
        and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)),
      );

    const hold = await lockAuthorizedHold(tx, input.reservationId);
    if (hold) {
      await tx
        .update(payments)
        .set({
          status: "completed",
          capturedAmount: input.amount,
          notes: input.reason,
          paidAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(payments.id, hold.id));
    }

    await tx.insert(payments).values({
      id: input.capturePaymentId,
      reservationId: input.reservationId,
      amount: input.amount,
      type: "deposit_capture",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: input.paymentIntentId,
      stripeChargeId: input.stripeChargeId,
      stripeAccountId: input.stripeAccountId,
      currency: input.currency,
      grossMinor: input.capturedMinor,
      insuranceShareMinor: 0,
      origin: "deposit",
      notes: input.reason,
      paidAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    });
    await markReservation(tx, { id: input.reservationId, storeId: input.storeId });
  });
}

/** Records a released deposit: the hold is cancelled. */
export async function recordDepositRelease(
  database: Database,
  input: ReservationRef & { readonly now: Date },
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ depositStatus: "released", updatedAt: input.now })
      .where(
        and(eq(reservations.id, input.reservationId), eq(reservations.storeId, input.storeId)),
      );

    const hold = await lockAuthorizedHold(tx, input.reservationId);
    if (hold) {
      await tx
        .update(payments)
        .set({ status: "cancelled", updatedAt: input.now })
        .where(eq(payments.id, hold.id));
    }
    await markReservation(tx, { id: input.reservationId, storeId: input.storeId });
  });
}

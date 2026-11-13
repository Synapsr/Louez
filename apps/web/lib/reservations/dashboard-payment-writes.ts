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

// The payment writes of the dashboard's reservation actions. The payment
// procedures (packages/api services/payment-records.ts) record through
// `insertRecordedPayment`, lent as `ApiPorts.paymentRecords`. Each one writes its
// rows and marks the reservation for the billing service in one transaction
// (louez-billing docs/api, README §5.2). Stripe calls stay with the caller, before
// the transaction. A deposit hold, its capture and
// its release are written by lib/reservations/deposit-hold-writes.ts.

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
      source: reservations.source,
      totalAmount: reservations.totalAmount,
      subtotalAmount: reservations.subtotalAmount,
      depositAmount: reservations.depositAmount,
      deliveryFee: reservations.deliveryFee,
      discountAmount: reservations.discountAmount,
      subtotalExclTax: reservations.subtotalExclTax,
      taxAmount: reservations.taxAmount,
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
 * refunds and never sent as a payment, so it has no insurance share. It keeps the
 * currency of the payment it refunds, even the EUR default of an older manual
 * row: its credit note takes this currency and must match that payment's invoice.
 * The billing service is unaffected: the snapshot builder takes a non-Stripe
 * payment's currency from the reservation (contract Q4) and reads only the
 * refund's amount.
 */
export async function insertManualRefund(tx: Transaction, input: ManualRefundInput): Promise<void> {
  const currency =
    input.original.currency ?? reservationCurrency(input.reservationCurrency, input.storeSettings);
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

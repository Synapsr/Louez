import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  paymentDisputes,
  paymentRequests,
  payments,
  platformFees,
  reservationActivity,
  reservationItems,
  reservations,
  stores,
} from "@louez/db";

import { reservationTotalsMinor } from "@/lib/billing-sync/money";

import type { BuiltSnapshot, SnapshotKey, SnapshotReader } from "./build-snapshot";
import { buildPaymentSnapshots } from "./reservation-payments";
import { SnapshotDataError, snapshotChecks } from "./snapshot-checks";
import type { ReservationSnapshotData } from "./snapshot-data";

// openapi.yaml ReservationSnapshotV1. No renter data and no free text (README §11).
// Tables without a store column are read through their reservation, filtered by the
// store, so a key with the wrong store finds nothing.

export async function buildReservationSnapshot(
  db: SnapshotReader,
  key: SnapshotKey,
): Promise<BuiltSnapshot> {
  const reservationId = key.aggregateId;
  const checks = snapshotChecks(`reservation ${reservationId}`);
  const ofReservation = and(
    eq(reservations.id, reservationId),
    eq(reservations.storeId, key.storeId),
  );

  const [reservation] = await db
    .select({
      number: reservations.number,
      status: reservations.status,
      source: reservations.source,
      createdAt: reservations.createdAt,
      startDate: reservations.startDate,
      endDate: reservations.endDate,
      billableAt: reservations.billableAt,
      withdrawnAt: reservations.withdrawnAt,
      currency: reservations.currency,
      totalAmount: reservations.totalAmount,
      subtotalAmount: reservations.subtotalAmount,
      depositAmount: reservations.depositAmount,
      tulipInsuranceAmount: reservations.tulipInsuranceAmount,
      storeSettings: stores.settings,
      storeStripeAccountId: stores.stripeAccountId,
    })
    .from(reservations)
    .innerJoin(stores, eq(stores.id, reservations.storeId))
    .where(ofReservation)
    .limit(1);
  if (!reservation) return { kind: "missing" };

  const items = await db
    .select({
      productId: reservationItems.productId,
      taxRate: reservationItems.taxRate,
      totalPrice: reservationItems.totalPrice,
    })
    .from(reservationItems)
    .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
    .where(ofReservation);

  const rows = await db
    .select({
      id: payments.id,
      type: payments.type,
      method: payments.method,
      status: payments.status,
      amount: payments.amount,
      currency: payments.currency,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      stripeChargeId: payments.stripeChargeId,
      stripeCheckoutSessionId: payments.stripeCheckoutSessionId,
      stripeRefundId: payments.stripeRefundId,
      refundOfPaymentId: payments.refundOfPaymentId,
      grossMinor: payments.grossMinor,
      insuranceShareMinor: payments.insuranceShareMinor,
      origin: payments.origin,
      paymentRequestId: payments.paymentRequestId,
      stripeAccountId: payments.stripeAccountId,
      appFeeTotalMinor: payments.appFeeTotalMinor,
      appFeeReservationMinor: payments.appFeeReservationMinor,
      appFeeMarketplaceMinor: payments.appFeeMarketplaceMinor,
      appFeeBaseMinor: payments.appFeeBaseMinor,
      appFeePolicyScope: payments.appFeePolicyScope,
      appFeePolicyVersion: payments.appFeePolicyVersion,
      appFeeMetadataVersion: payments.appFeeMetadataVersion,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
      updatedAt: payments.updatedAt,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(ofReservation)
    .orderBy(asc(payments.createdAt), asc(payments.id));

  const disputes = await db
    .select({
      id: paymentDisputes.id,
      paymentId: paymentDisputes.paymentId,
      amountMinor: paymentDisputes.amountMinor,
      status: paymentDisputes.status,
      openedAt: paymentDisputes.openedAt,
      closedAt: paymentDisputes.closedAt,
    })
    .from(paymentDisputes)
    .innerJoin(reservations, eq(reservations.id, paymentDisputes.reservationId))
    // Inquiries withdraw no funds and are never sent (README Q15).
    .where(and(ofReservation, isNotNull(paymentDisputes.openedAt)))
    .orderBy(asc(paymentDisputes.openedAt), asc(paymentDisputes.id));

  const customRequests = await db
    .select({ id: paymentRequests.id })
    .from(paymentRequests)
    .where(
      and(
        eq(paymentRequests.storeId, key.storeId),
        eq(paymentRequests.reservationId, reservationId),
        eq(paymentRequests.type, "custom"),
      ),
    );

  // Extension payments written before `payments.origin` are named by the extension's
  // activity row.
  const extensionPaymentId = sql<
    string | null
  >`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.paymentId'))`;
  const extensions = await db
    .select({ paymentId: extensionPaymentId })
    .from(reservationActivity)
    .innerJoin(reservations, eq(reservations.id, reservationActivity.reservationId))
    .where(
      and(
        ofReservation,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${reservationActivity.metadata}, '$.kind')) = 'rental_extension'`,
      ),
    );

  const legacyFees = await db
    .select({
      dedupKey: platformFees.dedupKey,
      amountCents: platformFees.amountCents,
      stripePaymentIntentId: platformFees.stripePaymentIntentId,
    })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.storeId, key.storeId),
        eq(platformFees.reservationId, reservationId),
        inArray(platformFees.dedupKey, [`res:${reservationId}`, `mkt:${reservationId}`]),
      ),
    );

  let totals: ReturnType<typeof reservationTotalsMinor>;
  try {
    totals = reservationTotalsMinor({
      reservation,
      storeSettings: reservation.storeSettings,
      items,
    });
  } catch (error) {
    // A stored amount Louez cannot convert, such as a three-decimal currency.
    throw new SnapshotDataError(
      `reservation ${reservationId}`,
      `totals: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const data: ReservationSnapshotData = {
    deleted: false,
    number: checks.text("number", reservation.number, 50),
    status: reservation.status,
    source: checks.textOrNull("source", reservation.source, 20),
    createdAt: checks.timestamp("createdAt", reservation.createdAt),
    startAt: checks.timestamp("startAt", reservation.startDate),
    endAt: checks.timestamp("endAt", reservation.endDate),
    billableAt: checks.timestampOrNull("billableAt", reservation.billableAt),
    withdrawnAt: checks.timestampOrNull("withdrawnAt", reservation.withdrawnAt),
    currency: totals.currency,
    totalInclTaxMinor: checks.amount("totalInclTaxMinor", totals.totalInclTaxMinor),
    insuranceMinor: checks.amount("insuranceMinor", totals.insuranceMinor),
    payments: buildPaymentSnapshots({
      checks,
      reservationId,
      reservationCurrency: totals.currency,
      totalInclTaxMinor: totals.totalInclTaxMinor,
      insuranceMinor: totals.insuranceMinor,
      storeStripeAccountId: reservation.storeStripeAccountId,
      rows,
      disputes,
      customRequestIds: new Set(customRequests.map((request) => request.id)),
      extensionPaymentIds: new Set(
        extensions.flatMap((row) => (row.paymentId === null ? [] : [row.paymentId])),
      ),
      legacyFees,
    }),
  };
  return { kind: "snapshot", data };
}

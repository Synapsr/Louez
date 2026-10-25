import { and, asc, eq } from "drizzle-orm";

import { payAsYouGoInvoices, platformFees, stores } from "@louez/db";

import { normalizeCurrency } from "@/lib/billing-sync/money";

import type { BuiltSnapshot, SnapshotContext, SnapshotKey, SnapshotReader } from "./build-snapshot";
import { isPeriod, snapshotChecks } from "./snapshot-checks";
import type { LegacyMonthSnapshotData } from "./snapshot-data";

// openapi.yaml LegacyMonthSnapshotV1: one store's legacy fee rows and month-end
// invoice for one UTC month, for the shadow comparison until M6. The aggregate id is
// `{storeId}:{YYYY-MM}`. Not paged: the largest month holds about 100 rows (Q41).

export async function buildLegacyMonthSnapshot(
  db: SnapshotReader,
  key: SnapshotKey,
  context: SnapshotContext,
): Promise<BuiltSnapshot> {
  const checks = snapshotChecks(`legacy_month ${key.aggregateId}`);
  const separator = key.aggregateId.lastIndexOf(":");
  const period = key.aggregateId.slice(separator + 1);
  if (separator < 0 || key.aggregateId.slice(0, separator) !== key.storeId || !isPeriod(period))
    checks.fail(`aggregate id is not {storeId}:{YYYY-MM} of store ${key.storeId}`);

  const [store] = await db
    .select({ createdAt: stores.createdAt })
    .from(stores)
    .where(eq(stores.id, key.storeId))
    .limit(1);
  if (!store) return { kind: "missing" };
  if (store.createdAt.getTime() >= context.newStoresFrom.getTime())
    return { kind: "skip", reason: "new_store" };

  const fees = await db
    .select({
      id: platformFees.id,
      reservationId: platformFees.reservationId,
      paymentId: platformFees.paymentId,
      dedupKey: platformFees.dedupKey,
      source: platformFees.source,
      status: platformFees.status,
      amountCents: platformFees.amountCents,
      amountReversedCents: platformFees.amountReversedCents,
      currency: platformFees.currency,
      billingMonth: platformFees.billingMonth,
      monthlyIndex: platformFees.monthlyIndex,
      stripePaymentIntentId: platformFees.stripePaymentIntentId,
      stripeApplicationFeeId: platformFees.stripeApplicationFeeId,
      invoiceId: platformFees.invoiceId,
      createdAt: platformFees.createdAt,
      billedAt: platformFees.billedAt,
    })
    .from(platformFees)
    .where(and(eq(platformFees.storeId, key.storeId), eq(platformFees.billingMonth, period)))
    .orderBy(asc(platformFees.createdAt), asc(platformFees.id));

  const [invoice] = await db
    .select({
      id: payAsYouGoInvoices.id,
      status: payAsYouGoInvoices.status,
      locationCount: payAsYouGoInvoices.locationCount,
      grossAmountCents: payAsYouGoInvoices.grossAmountCents,
      collectedAtSourceCents: payAsYouGoInvoices.collectedAtSourceCents,
      invoicedAmountCents: payAsYouGoInvoices.invoicedAmountCents,
      usageLocationCount: payAsYouGoInvoices.usageLocationCount,
      usageFeeAmountCents: payAsYouGoInvoices.usageFeeAmountCents,
      marketplaceReservationCount: payAsYouGoInvoices.marketplaceReservationCount,
      marketplaceFeeAmountCents: payAsYouGoInvoices.marketplaceFeeAmountCents,
      currency: payAsYouGoInvoices.currency,
      stripeInvoiceId: payAsYouGoInvoices.stripeInvoiceId,
      createdAt: payAsYouGoInvoices.createdAt,
      paidAt: payAsYouGoInvoices.paidAt,
    })
    .from(payAsYouGoInvoices)
    .where(
      and(eq(payAsYouGoInvoices.storeId, key.storeId), eq(payAsYouGoInvoices.billingMonth, period)),
    )
    .limit(1);

  const data: LegacyMonthSnapshotData = {
    period,
    fees: fees.map((fee) => {
      const field = `fee ${fee.id}`;
      return {
        id: fee.id,
        reservationId: fee.reservationId,
        paymentId: fee.paymentId,
        dedupKey: checks.text(`${field} dedupKey`, fee.dedupKey, 80),
        source: fee.source,
        status: fee.status,
        amountMinor: checks.amount(`${field} amountMinor`, fee.amountCents),
        amountReversedMinor: checks.amount(`${field} amountReversedMinor`, fee.amountReversedCents),
        currency: normalizeCurrency(fee.currency),
        billingMonth: fee.billingMonth,
        monthlyIndex: checks.positiveOrNull(`${field} monthlyIndex`, fee.monthlyIndex),
        stripePaymentIntentId: fee.stripePaymentIntentId,
        stripeApplicationFeeId: fee.stripeApplicationFeeId,
        invoiceId: fee.invoiceId,
        createdAt: checks.timestamp(`${field} createdAt`, fee.createdAt),
        billedAt: checks.timestampOrNull(`${field} billedAt`, fee.billedAt),
      };
    }),
    invoice: invoice
      ? {
          id: invoice.id,
          status: invoice.status,
          locationCount: checks.count("invoice.locationCount", invoice.locationCount),
          grossAmountMinor: checks.amount("invoice.grossAmountMinor", invoice.grossAmountCents),
          collectedAtSourceMinor: checks.amount(
            "invoice.collectedAtSourceMinor",
            invoice.collectedAtSourceCents,
          ),
          invoicedAmountMinor: checks.amount(
            "invoice.invoicedAmountMinor",
            invoice.invoicedAmountCents,
          ),
          usageLocationCount: checks.count(
            "invoice.usageLocationCount",
            invoice.usageLocationCount,
          ),
          usageFeeAmountMinor: checks.amount(
            "invoice.usageFeeAmountMinor",
            invoice.usageFeeAmountCents,
          ),
          marketplaceReservationCount: checks.count(
            "invoice.marketplaceReservationCount",
            invoice.marketplaceReservationCount,
          ),
          marketplaceFeeAmountMinor: checks.amount(
            "invoice.marketplaceFeeAmountMinor",
            invoice.marketplaceFeeAmountCents,
          ),
          currency: normalizeCurrency(invoice.currency),
          stripeInvoiceId: invoice.stripeInvoiceId,
          createdAt: checks.timestamp("invoice.createdAt", invoice.createdAt),
          paidAt: checks.timestampOrNull("invoice.paidAt", invoice.paidAt),
        }
      : null,
  };
  return { kind: "snapshot", data };
}

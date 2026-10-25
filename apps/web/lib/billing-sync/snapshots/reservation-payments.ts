import type { payments, paymentDisputes } from "@louez/db";
import { isStripeRefundRow } from "@louez/utils";

import type { PaymentKind } from "@/lib/billing-sync/fee-metadata";
import { insuranceShare, normalizeCurrency } from "@/lib/billing-sync/money";

import { compareCodeUnits, type SnapshotChecks } from "./snapshot-checks";
import type {
  AppFeeSnapshot,
  DisputeSnapshot,
  PaymentSnapshot,
  RefundSnapshot,
} from "./snapshot-data";

// The `payments` list of a reservation snapshot (openapi.yaml Payment, Refund,
// Dispute, StripePaymentRefs, AppFee), built from the rows the builder loaded.
// Refund rows are never payments: each one is folded onto the payment it refunds
// (fees.md §6, README Q7).

type PaymentColumns = typeof payments.$inferSelect;

export type PaymentRow = Pick<
  PaymentColumns,
  | "id"
  | "type"
  | "method"
  | "status"
  | "amount"
  | "currency"
  | "stripePaymentIntentId"
  | "stripeChargeId"
  | "stripeCheckoutSessionId"
  | "stripeRefundId"
  | "refundOfPaymentId"
  | "grossMinor"
  | "insuranceShareMinor"
  | "origin"
  | "paymentRequestId"
  | "stripeAccountId"
  | "appFeeTotalMinor"
  | "appFeeReservationMinor"
  | "appFeeMarketplaceMinor"
  | "appFeeBaseMinor"
  | "appFeePolicyScope"
  | "appFeePolicyVersion"
  | "appFeeMetadataVersion"
  | "paidAt"
  | "createdAt"
  | "updatedAt"
>;

export type DisputeRow = Pick<
  typeof paymentDisputes.$inferSelect,
  "id" | "paymentId" | "amountMinor" | "status" | "openedAt" | "closedAt"
>;

/** A legacy `platform_fee` row of the reservation (`res:` or `mkt:`). */
export type LegacyFeeRow = {
  readonly dedupKey: string;
  readonly amountCents: number;
  readonly stripePaymentIntentId: string | null;
};

export type PaymentsInput = {
  readonly checks: SnapshotChecks;
  readonly reservationId: string;
  /** The reservation's currency, for every payment whose method is not `stripe` (Q4). */
  readonly reservationCurrency: string;
  readonly totalInclTaxMinor: number;
  readonly insuranceMinor: number;
  /** The store's current Connect account, for payments that predate `stripe_account_id`. */
  readonly storeStripeAccountId: string | null;
  /** Every `payments` row of the reservation, refund rows included. */
  readonly rows: readonly PaymentRow[];
  /** Disputes whose funds Stripe withdrew (`opened_at` set). */
  readonly disputes: readonly DisputeRow[];
  /** Ids of the reservation's payment requests of type `custom`. */
  readonly customRequestIds: ReadonlySet<string>;
  /** Payment ids named by `rental_extension` activity rows, for rows with no origin. */
  readonly extensionPaymentIds: ReadonlySet<string>;
  readonly legacyFees: readonly LegacyFeeRow[];
};

/** openapi.yaml limits; going over them throws instead of truncating. */
export const MAX_PAYMENTS = 200;
export const MAX_REFUNDS = 100;
export const MAX_DISPUTES = 20;

const isRefundRow = (row: PaymentRow): boolean =>
  row.refundOfPaymentId !== null || isStripeRefundRow(row);

/** Plan decision 8 (README Q36): extensions and custom requests are stored as `rental`. */
function paymentKind(row: PaymentRow, input: PaymentsInput): PaymentKind {
  if (row.type !== "rental") return row.type;
  if (row.origin === "extension") return "extension";
  if (row.origin === null && input.extensionPaymentIds.has(row.id)) return "extension";
  if (row.paymentRequestId !== null && input.customRequestIds.has(row.paymentRequestId))
    return "custom_request";
  return "rental";
}

/**
 * The fee Louez asked Stripe to take at source: the copied session metadata, else,
 * for older Stripe payments, the legacy `res:` and `mkt:` rows recorded with the same
 * PaymentIntent (metadata v3, no percent base).
 */
function appFee(
  row: PaymentRow,
  input: PaymentsInput,
  checks: SnapshotChecks,
): AppFeeSnapshot | null {
  const field = `payment ${row.id} appFee`;
  if (row.appFeeMetadataVersion !== null) {
    const metadataVersion = row.appFeeMetadataVersion;
    if (metadataVersion !== 3 && metadataVersion !== 4)
      return checks.fail(`${field} has metadata version ${metadataVersion}`);
    const stored = (name: string, value: number | null): number =>
      value === null ? checks.fail(`${field}.${name} is missing`) : checks.amount(field, value);
    const scope = row.appFeePolicyScope;
    return {
      totalMinor: stored("totalMinor", row.appFeeTotalMinor),
      reservationMinor: stored("reservationMinor", row.appFeeReservationMinor),
      marketplaceMinor: stored("marketplaceMinor", row.appFeeMarketplaceMinor),
      baseMinor: stored("baseMinor", row.appFeeBaseMinor),
      policy:
        scope === "store" || scope === "default"
          ? {
              scope,
              version:
                checks.positiveOrNull(`${field}.policy.version`, row.appFeePolicyVersion) ??
                checks.fail(`${field}.policy.version is missing`),
            }
          : null,
      metadataVersion,
    };
  }

  const paymentIntentId = row.stripePaymentIntentId;
  if (row.method !== "stripe" || paymentIntentId === null) return null;
  const legacy = (prefix: "res" | "mkt") =>
    input.legacyFees.find(
      (fee) =>
        fee.dedupKey === `${prefix}:${input.reservationId}` &&
        fee.stripePaymentIntentId === paymentIntentId,
    );
  const reservationFee = legacy("res");
  const marketplaceFee = legacy("mkt");
  if (!reservationFee && !marketplaceFee) return null;
  const reservationMinor = checks.amount(field, reservationFee?.amountCents ?? 0);
  const marketplaceMinor = checks.amount(field, marketplaceFee?.amountCents ?? 0);
  return {
    totalMinor: checks.amount(field, reservationMinor + marketplaceMinor),
    reservationMinor,
    marketplaceMinor,
    baseMinor: 0,
    policy: null,
    metadataVersion: 3,
  };
}

/**
 * Builds the payments of a reservation snapshot.
 *
 * Refunds come in three historical shapes (README Q7):
 * - a Stripe refund row (refund id, no PaymentIntent, no session) linked to its
 *   charge by `refund_of_payment_id`, or, when unlinked, by the charge id of the
 *   only original that carries it;
 * - before 2026-08-20, the original itself stamped with the refund id and netted.
 *   Its refund is `gross − net − linked rows`, so only when `gross_minor` is known;
 * - a manual refund row linked by `refund_of_payment_id`, sent with its own id.
 *
 * A Stripe original is netted in place by refunds, so without `gross_minor` its gross
 * is approximated as `amount + linked Stripe refund rows` (plan decision 6) until
 * the backfill from Stripe. Refund money Louez cannot attach to a refund id is not
 * sent: there is no id the service could keep stable.
 */
export function buildPaymentSnapshots(input: PaymentsInput): PaymentSnapshot[] {
  const { checks } = input;
  const originals = input.rows.filter((row) => !isRefundRow(row));
  checks.limit("payments", originals.length, MAX_PAYMENTS);
  // A refund row that did not complete moved no money.
  const refundRows = input.rows.filter((row) => isRefundRow(row) && row.status === "completed");

  const originalsByCharge = new Map<string, number>();
  for (const row of originals) {
    if (row.stripeChargeId !== null)
      originalsByCharge.set(
        row.stripeChargeId,
        (originalsByCharge.get(row.stripeChargeId) ?? 0) + 1,
      );
  }
  const refundsOriginal = (refund: PaymentRow, original: PaymentRow): boolean => {
    if (refund.refundOfPaymentId !== null) return refund.refundOfPaymentId === original.id;
    return (
      isStripeRefundRow(refund) &&
      original.stripeChargeId !== null &&
      refund.stripeChargeId === original.stripeChargeId &&
      originalsByCharge.get(original.stripeChargeId) === 1
    );
  };

  return originals.map((row) => {
    const field = `payment ${row.id}`;
    const kind = paymentKind(row, input);
    const isStripe = row.method === "stripe";
    const currency = isStripe
      ? normalizeCurrency(row.currency, input.reservationCurrency)
      : input.reservationCurrency;
    const minor = (refund: PaymentRow) =>
      checks.decimal(`refund row ${refund.id} amount`, refund.amount, currency);

    const linked = refundRows.filter((refund) => refundsOriginal(refund, row));
    const stripeRows = linked.filter((refund) => isStripeRefundRow(refund));
    const manualRows = linked.filter((refund) => !isStripeRefundRow(refund));
    const stripeRefundedMinor = stripeRows.reduce((sum, refund) => sum + minor(refund), 0);

    const netMinor = checks.decimal(`${field} amount`, row.amount, currency);
    const grossMinor = checks.signedAmount(
      `${field} grossMinor`,
      row.grossMinor ?? (isStripe ? netMinor + stripeRefundedMinor : netMinor),
    );

    const refunds = new Map<string, RefundSnapshot>();
    const addRefund = (refund: RefundSnapshot) => {
      if (refund.amountMinor === 0 || refunds.has(refund.refundId)) return;
      checks.amount(`${field} refund ${refund.refundId}`, refund.amountMinor);
      refunds.set(refund.refundId, refund);
    };
    for (const refund of stripeRows) {
      const refundId = refund.stripeRefundId ?? checks.fail(`refund row ${refund.id} has no id`);
      addRefund({
        refundId,
        amountMinor: minor(refund),
        refundedAt: checks.timestamp(
          `refund row ${refund.id} paidAt`,
          refund.paidAt ?? refund.createdAt,
        ),
        via: "stripe",
        stripeRefundId: refundId,
      });
    }
    if (isStripe && row.stripeRefundId !== null && row.grossMinor !== null) {
      // The original was netted and carries the last refund id; its update time is
      // the only date Louez kept for that refund.
      addRefund({
        refundId: row.stripeRefundId,
        amountMinor: Math.max(0, row.grossMinor - netMinor - stripeRefundedMinor),
        refundedAt: checks.timestamp(`${field} updatedAt`, row.updatedAt),
        via: "stripe",
        stripeRefundId: row.stripeRefundId,
      });
    }
    for (const refund of manualRows) {
      addRefund({
        refundId: refund.id,
        amountMinor: minor(refund),
        refundedAt: checks.timestamp(
          `refund row ${refund.id} paidAt`,
          refund.paidAt ?? refund.createdAt,
        ),
        via: "manual",
        stripeRefundId: null,
      });
    }
    const sortedRefunds = [...refunds.values()].sort(
      (a, b) =>
        compareCodeUnits(a.refundedAt, b.refundedAt) || compareCodeUnits(a.refundId, b.refundId),
    );
    checks.limit(`${field} refunds`, sortedRefunds.length, MAX_REFUNDS);

    const disputes: DisputeSnapshot[] = [];
    for (const dispute of input.disputes) {
      if (dispute.paymentId !== row.id || dispute.openedAt === null) continue;
      // A dispute of 0 withdrew nothing.
      if (dispute.amountMinor === 0) continue;
      disputes.push({
        disputeId: dispute.id,
        amountMinor: checks.amount(`dispute ${dispute.id} amountMinor`, dispute.amountMinor),
        status: dispute.status,
        openedAt: checks.timestamp(`dispute ${dispute.id} openedAt`, dispute.openedAt),
        closedAt: checks.timestampOrNull(`dispute ${dispute.id} closedAt`, dispute.closedAt),
      });
    }
    checks.limit(`${field} disputes`, disputes.length, MAX_DISPUTES);

    // Stored once when the payment was created (fees.md §4); rows written before the
    // column get it from the reservation as it is now. Other kinds carry none.
    const insuranceShareMinor =
      kind === "rental" || kind === "extension"
        ? checks.amount(
            `${field} insuranceShareMinor`,
            row.insuranceShareMinor ??
              insuranceShare({
                insuranceMinor: input.insuranceMinor,
                grossMinor,
                totalInclTaxMinor: input.totalInclTaxMinor,
              }),
          )
        : 0;

    return {
      paymentId: row.id,
      kind,
      method: row.method,
      status: row.status,
      currency,
      grossMinor,
      insuranceShareMinor,
      paidAt: checks.timestampOrNull(`${field} paidAt`, row.paidAt),
      refunds: sortedRefunds,
      disputes,
      stripe: isStripe
        ? {
            accountId: row.stripeAccountId ?? input.storeStripeAccountId,
            paymentIntentId: row.stripePaymentIntentId,
            chargeId: row.stripeChargeId,
            checkoutSessionId: row.stripeCheckoutSessionId,
          }
        : null,
      appFee: appFee(row, input, checks),
    };
  });
}

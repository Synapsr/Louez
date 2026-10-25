import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, markReservation, paymentRequests, payments, reservations } from "@louez/db";

import type { FeeFacts, PaymentKind } from "@/lib/billing-sync/fee-metadata";
import { insuranceShare, type ReservationTotalsMinor } from "@/lib/billing-sync/money";
import { log } from "@/lib/evlog";

/** Where a checkout payment came from (billing contract Q36). */
export type CheckoutPaymentOrigin = "checkout" | "customer_session" | "payment_request";

/**
 * The insurance part of a payment (billing fees.md §4), read once when the payment is
 * created: 0 for kinds other than rental and extension. Null when the reservation's
 * amounts cannot be read in minor units; the backfill then computes it.
 */
export function paymentInsuranceShareMinor(
  kind: PaymentKind,
  grossMinor: number,
  readTotals: () => Pick<ReservationTotalsMinor, "insuranceMinor" | "totalInclTaxMinor">,
): number | null {
  if (kind !== "rental" && kind !== "extension") return 0;
  try {
    const totals = readTotals();
    return insuranceShare({
      insuranceMinor: totals.insuranceMinor,
      totalInclTaxMinor: totals.totalInclTaxMinor,
      grossMinor,
    });
  } catch (error) {
    log.error(
      "billing",
      `insurance share not computed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

interface ClaimCompletedCheckoutPaymentParams {
  reservationId: string;
  amount: number;
  currency: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripePaymentMethodId: string | null;
  /** The connected account the session was created on. */
  stripeAccountId: string | null;
  /** When Louez records the payment: the row's creation time. */
  claimedAt: Date;
  /** The charge's `created` time when known, else the claim time (contract Q36). */
  paidAt: Date;
  /** The charge amount, in minor units. */
  grossMinor: number;
  insuranceShareMinor: number | null;
  /** For a payment without a pending row; a pending row keeps the origin it got at insert. */
  origin: CheckoutPaymentOrigin;
  /** The payment request this session pays, completed in the same transaction. */
  paymentRequestId: string | null;
  /** The fee Louez asked Stripe to take, from the session metadata. */
  feeFacts: FeeFacts | null;
}

/** The `app_fee_*` columns; nothing when the session carried no fee metadata. */
export const appFeeColumns = (facts: FeeFacts | null) =>
  facts
    ? {
        appFeeTotalMinor: facts.totalMinor,
        appFeeReservationMinor: facts.reservationMinor,
        appFeeMarketplaceMinor: facts.marketplaceMinor,
        appFeeBaseMinor: facts.baseMinor,
        appFeePolicyScope: facts.policyScope,
        appFeePolicyVersion: facts.policyVersion,
        appFeeMetadataVersion: facts.metadataVersion,
      }
    : {};

export async function claimCompletedCheckoutPayment(
  params: ClaimCompletedCheckoutPaymentParams,
): Promise<{ paymentId: string; claimed: boolean }> {
  return db.transaction(async (tx) => {
    // The reservation lock serializes the success page and webhook before
    // either can claim payment effects for this checkout.
    const [lockedReservation] = await tx
      .select({ id: reservations.id, storeId: reservations.storeId })
      .from(reservations)
      .where(eq(reservations.id, params.reservationId))
      .for("update");

    if (!lockedReservation) {
      throw new Error("Reservation not found while completing checkout payment");
    }

    // Idempotent: the first completion wins, a replay changes nothing.
    if (params.paymentRequestId) {
      await tx
        .update(paymentRequests)
        .set({ status: "completed", completedAt: params.claimedAt })
        .where(
          and(
            eq(paymentRequests.id, params.paymentRequestId),
            eq(paymentRequests.storeId, lockedReservation.storeId),
            eq(paymentRequests.reservationId, params.reservationId),
            ne(paymentRequests.status, "completed"),
          ),
        );
    }

    const [existingPayment] = await tx
      .select({
        id: payments.id,
        status: payments.status,
        origin: payments.origin,
        paymentRequestId: payments.paymentRequestId,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, params.reservationId),
          eq(payments.stripeCheckoutSessionId, params.stripeCheckoutSessionId),
        ),
      )
      .limit(1)
      .for("update");

    if (existingPayment?.status === "completed") {
      return { paymentId: existingPayment.id, claimed: false };
    }

    const facts = {
      stripePaymentIntentId: params.stripePaymentIntentId,
      stripeChargeId: params.stripeChargeId,
      stripePaymentMethodId: params.stripePaymentMethodId,
      stripeAccountId: params.stripeAccountId,
      grossMinor: params.grossMinor,
      insuranceShareMinor: params.insuranceShareMinor,
      paidAt: params.paidAt,
      ...appFeeColumns(params.feeFacts),
    };

    let paymentId: string;
    if (existingPayment) {
      paymentId = existingPayment.id;
      await tx
        .update(payments)
        .set({
          ...facts,
          status: "completed",
          origin: existingPayment.origin ?? params.origin,
          paymentRequestId: existingPayment.paymentRequestId ?? params.paymentRequestId,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, existingPayment.id));
    } else {
      paymentId = nanoid();
      await tx.insert(payments).values({
        ...facts,
        id: paymentId,
        reservationId: params.reservationId,
        amount: params.amount.toFixed(2),
        type: "rental",
        method: "stripe",
        status: "completed",
        stripeCheckoutSessionId: params.stripeCheckoutSessionId,
        origin: params.origin,
        paymentRequestId: params.paymentRequestId,
        currency: params.currency,
        createdAt: params.claimedAt,
        updatedAt: new Date(),
      });
    }

    await markReservation(tx, lockedReservation);
    return { paymentId, claimed: true };
  });
}

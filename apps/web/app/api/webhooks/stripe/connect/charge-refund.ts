import { nanoid } from "nanoid";
import type Stripe from "stripe";

import { db, reservationActivity } from "@louez/db";

import { log } from "@/lib/evlog";
import { getReferralProgramConfig } from "@/lib/referral/defaults";
import { clawbackReferrerRewardForQualifyingPayment } from "@/lib/referral/rewards";
import {
  type ProviderRefund,
  REFUND_OPERATION_METADATA,
  type StripeRefundObject,
  providerRefundFromStripe,
  refundMovedMoney,
} from "@/lib/reservations/stripe-refund-stripe";
import {
  issueRefundCreditNotes,
  recordChargeRefunds,
  recordRefundFailure,
} from "@/lib/reservations/stripe-refund-writes";
import { fromStripeCents } from "@/lib/stripe";
import { stripe } from "@/lib/stripe/client";

import { findChargePayment, isKnownPaymentIntent } from "./charge-writes";
import { type FeeReversalStripe, reverseFeeAtSource, stripeFeeReversal } from "./fee-reversal";

// `charge.refunded` on a connected account (louez-billing design §5.6, docs/api
// fees.md §9 and README Q7): the fee refund at source, then, through the one writer of
// a charge's refunds (lib/reservations/stripe-refund-writes.ts), the payment netted,
// one refund row per Stripe refund of the charge whatever the payment's kind, and the
// refund operation each refund names settled.

/**
 * The event's charge. A retry can deliver an event after a newer one, so the handler
 * reads the refunds from Stripe, not `amount_refunded` or `refunded`. After a partial
 * capture, `amount` is the amount authorized, more than the money.
 */
export type RefundedChargeEvent = Pick<
  Stripe.Charge,
  | "id"
  | "amount"
  | "amount_captured"
  | "amount_refunded"
  | "captured"
  | "refunded"
  | "currency"
  | "payment_intent"
  | "application_fee"
  | "metadata"
>;

type StripeRefund = Pick<Stripe.Refund, "id" | "amount" | "created" | "status"> & {
  /** Names the refund operation of Louez that asked for it, if one did. */
  readonly metadata?: Stripe.Metadata | null;
  readonly failure_reason?: string | null;
};

/** The Stripe calls of the handler. The webhook uses `stripeChargeRefund`; tests fake it. */
export type ChargeRefundStripe = {
  readonly feeReversal: FeeReversalStripe;
  /** Every refund of the charge, on the connected account. */
  listRefunds(chargeId: string, accountId: string): Promise<readonly StripeRefund[]>;
  /** The PaymentIntent's metadata, on the connected account. */
  paymentIntentMetadata(paymentIntentId: string, accountId: string): Promise<Stripe.Metadata>;
};

export const stripeChargeRefund: ChargeRefundStripe = {
  feeReversal: stripeFeeReversal,
  async listRefunds(chargeId, accountId) {
    const refunds: Stripe.Refund[] = [];
    // Since API version 2022-11-15 a Charge lists its refunds only when expanded, and
    // an event cannot expand: the event's charge carries none.
    for await (const refund of stripe.refunds.list(
      { charge: chargeId, limit: 100 },
      { stripeAccount: accountId },
    ))
      refunds.push(refund);
    return refunds;
  },
  async paymentIntentMetadata(paymentIntentId, accountId) {
    const intent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {},
      { stripeAccount: accountId },
    );
    return intent.metadata;
  },
};

const stripeId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/** A refund the charge lists, in the charge's currency. */
const listedRefund = (refund: StripeRefund, currency: string): ProviderRefund => ({
  id: refund.id,
  amount: refund.amount,
  created: refund.created,
  status: refund.status,
  currency,
  failureReason: refund.failure_reason ?? null,
  operationId: refund.metadata?.[REFUND_OPERATION_METADATA] || null,
});

/** A charge of a Louez reservation has no payment yet: answer 500, Stripe retries. */
export class PaymentNotFoundYetError extends Error {
  constructor(chargeId: string) {
    super(`charge ${chargeId} belongs to a Louez reservation but has no payment yet`);
    this.name = "PaymentNotFoundYetError";
  }
}

export type ChargeRefundResult =
  | { readonly status: "recorded"; readonly paymentId: string; readonly refundRows: number }
  | { readonly status: "missing_account" | "not_captured" | "payment_not_found" };

/**
 * Handles `charge.refunded`. Every write is idempotent, so a thrown error answers 500
 * and Stripe's retry redoes the whole handler.
 */
export async function handleChargeRefunded(
  charge: RefundedChargeEvent,
  accountId: string | undefined,
  port: ChargeRefundStripe = stripeChargeRefund,
): Promise<ChargeRefundResult> {
  if (!accountId) {
    log.error({
      stripeWebhook: { event: "charge.refunded", issue: "missing_account", chargeId: charge.id },
    });
    return { status: "missing_account" };
  }

  // An authorization released or expired before capture took no money. Before API
  // version 2025-03-31.basil Stripe still refunded it with this event, and a deposit
  // hold's row carries the PaymentIntent: it is not a payment Louez has yet to write.
  if (!charge.captured) {
    log.info({
      stripeWebhook: { event: "charge.refunded", issue: "not_captured", chargeId: charge.id },
    });
    return { status: "not_captured" };
  }

  // The fee follows the money, whether or not Louez holds the payment. A charge
  // without an application fee never gets one, so it needs no Stripe call.
  if (charge.application_fee) {
    await reverseFeeAtSource({ chargeId: charge.id, accountId, stripe: port.feeReversal });
  }

  const paymentIntentId = stripeId(charge.payment_intent);
  const payment = await findChargePayment({ chargeId: charge.id, paymentIntentId, accountId });
  if (!payment) {
    const known = await isKnownPaymentIntent({
      paymentIntentId,
      accountId,
      readReservationId: async () => {
        const fromCharge = charge.metadata.reservationId;
        if (fromCharge || !paymentIntentId) return fromCharge || null;
        const fromIntent = await port.paymentIntentMetadata(paymentIntentId, accountId);
        return fromIntent.reservationId || null;
      },
    });
    if (known) throw new PaymentNotFoundYetError(charge.id);
    log.info({
      stripeWebhook: { event: "charge.refunded", issue: "payment_not_found", chargeId: charge.id },
    });
    return { status: "payment_not_found" };
  }

  // What the store keeps, from the refunds Stripe lists now. Since API version
  // 2025-03-31.basil a partial capture refunds nothing and `amount` stays the amount
  // authorized: the money is `amount_captured`.
  const currency = charge.currency.toUpperCase();
  const listed = (await port.listRefunds(charge.id, accountId)).map((refund) =>
    listedRefund(refund, currency),
  );
  const refunds = listed.filter(refundMovedMoney);
  const refundedMinor = refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const recorded = await recordChargeRefunds(db, {
    paymentId: payment.paymentId,
    reservationId: payment.reservationId,
    chargeId: charge.id,
    currency,
    amountCapturedMinor: charge.amount_captured,
    refunds: listed,
  });
  await issueRefundCreditNotes(payment.paymentId, recorded.rows, "stripe_charge_refunded_webhook");
  const netMinor = recorded.netMinor;
  const fullyRefunded = netMinor === 0;

  // Referral Program: a fully refunded qualifying payment, or a partial refund that
  // drops the net online payment below the qualifying minimum, claws back the Referrer
  // Reward (within the clawback window). Best-effort; never block refund processing.
  const minQualifyingAmountCents = getReferralProgramConfig().minQualifyingAmountCents;
  if (fullyRefunded || (minQualifyingAmountCents > 0 && netMinor < minQualifyingAmountCents)) {
    await clawbackReferrerRewardForQualifyingPayment({
      stripeChargeId: charge.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
    }).catch((error: unknown) => {
      log.error({
        referral: {
          event: "reward_clawback_failed",
          trigger: "refund",
          chargeId: charge.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  const refundAmount = fromStripeCents(refundedMinor, currency);
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId: payment.reservationId,
    activityType: "payment_updated",
    metadata: { chargeId: charge.id, refundAmount, isFullRefund: fullyRefunded },
    createdAt: new Date(),
  });

  log.info({
    stripeWebhook: {
      event: "charge.refunded",
      paymentId: payment.paymentId,
      chargeId: charge.id,
      refundAmount,
      isFullRefund: fullyRefunded,
      refundRows: refunds.length,
    },
  });
  return { status: "recorded", paymentId: payment.paymentId, refundRows: refunds.length };
}

export type RefundUpdatedResult =
  | { readonly status: "missing_account" | "moved_money" | "no_operation" }
  | { readonly status: "operation_failed"; readonly operationId: string };

/**
 * Handles `refund.failed`, `refund.updated` and `charge.refund.updated`: a refund that
 * failed or was canceled after Stripe made it closes the operation that asked for it
 * as `failed`. A refund row already written for it stays as it was (reservation
 * invariants, M8); the log says so. A refund that moves money is `charge.refunded`'s.
 */
export async function handleRefundUpdated(
  refund: StripeRefundObject,
  accountId: string | undefined,
): Promise<RefundUpdatedResult> {
  if (!accountId) {
    log.error({
      stripeWebhook: { event: "refund.updated", issue: "missing_account", refundId: refund.id },
    });
    return { status: "missing_account" };
  }
  const provider = providerRefundFromStripe(refund);
  if (refundMovedMoney(provider)) return { status: "moved_money" };
  const failed = await recordRefundFailure(db, { accountId, refund: provider });
  if (!failed) return { status: "no_operation" };
  if (failed.hadRefundRow) {
    log.error({
      stripeWebhook: {
        event: "refund.updated",
        issue: "recorded_refund_failed",
        refundId: refund.id,
        operationId: failed.operationId,
      },
    });
  }
  return { status: "operation_failed", operationId: failed.operationId };
}

import { nanoid } from "nanoid";
import type Stripe from "stripe";

import { db, reservationActivity } from "@louez/db";

import { log } from "@/lib/evlog";
import { ensureRefundPaymentRecord, tryGenerateCreditNoteForRefund } from "@/lib/invoicing/service";
import { getReferralProgramConfig } from "@/lib/referral/defaults";
import { clawbackReferrerRewardForQualifyingPayment } from "@/lib/referral/rewards";
import { fromStripeCents } from "@/lib/stripe";
import { stripe } from "@/lib/stripe/client";

import {
  type ChargePayment,
  findChargePayment,
  isKnownPaymentIntent,
  netRefundedChargePayment,
} from "./charge-writes";
import { type FeeReversalStripe, reverseFeeAtSource, stripeFeeReversal } from "./fee-reversal";

// `charge.refunded` on a connected account (louez-billing design §5.6, docs/api
// fees.md §9 and README Q7): the fee refund at source, the payment netted, and one
// refund row per Stripe refund of the charge, whatever the payment's kind.

export type RefundedChargeEvent = Pick<
  Stripe.Charge,
  | "id"
  | "amount"
  | "amount_refunded"
  | "refunded"
  | "currency"
  | "payment_intent"
  | "application_fee"
  | "metadata"
>;

type StripeRefund = Pick<Stripe.Refund, "id" | "amount" | "created" | "status">;

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

/** Failed and canceled refunds moved no money. */
const movedMoney = (refund: StripeRefund) =>
  refund.status !== "failed" && refund.status !== "canceled";

/** A deposit's money goes back as a deposit return; the rest as a rental refund. */
const refundType = (payment: ChargePayment): "rental" | "deposit_return" =>
  payment.type === "deposit" || payment.type === "deposit_capture" ? "deposit_return" : "rental";

/** A charge of a Louez reservation has no payment yet: answer 500, Stripe retries. */
export class PaymentNotFoundYetError extends Error {
  constructor(chargeId: string) {
    super(`charge ${chargeId} belongs to a Louez reservation but has no payment yet`);
    this.name = "PaymentNotFoundYetError";
  }
}

export type ChargeRefundResult =
  | { readonly status: "recorded"; readonly paymentId: string; readonly refundRows: number }
  | { readonly status: "missing_account" | "payment_not_found" };

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

  await netRefundedChargePayment({
    paymentId: payment.paymentId,
    reservationId: payment.reservationId,
    charge,
  });

  const currency = charge.currency.toUpperCase();
  const refunds = (await port.listRefunds(charge.id, accountId)).filter(movedMoney);
  for (const refund of refunds) {
    const amount = fromStripeCents(refund.amount, currency);
    const refundPaymentId = await ensureRefundPaymentRecord({
      originalPaymentId: payment.paymentId,
      stripeRefundId: refund.id,
      amount,
      grossMinor: refund.amount,
      currency,
      type: refundType(payment),
      paidAt: new Date(refund.created * 1000),
    });
    await tryGenerateCreditNoteForRefund(
      { originalPaymentId: payment.paymentId, refundPaymentId },
      amount,
      "stripe_charge_refunded_webhook",
    );
  }

  // Referral Program: a fully refunded qualifying payment, or a partial refund that
  // drops the net online payment below the qualifying minimum, claws back the Referrer
  // Reward (within the clawback window). Best-effort; never block refund processing.
  const netAmountCents = Math.max(0, charge.amount - charge.amount_refunded);
  const minQualifyingAmountCents = getReferralProgramConfig().minQualifyingAmountCents;
  if (
    charge.refunded ||
    (minQualifyingAmountCents > 0 && netAmountCents < minQualifyingAmountCents)
  ) {
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

  const refundAmount = fromStripeCents(charge.amount_refunded, currency);
  await db.insert(reservationActivity).values({
    id: nanoid(),
    reservationId: payment.reservationId,
    activityType: "payment_updated",
    metadata: { chargeId: charge.id, refundAmount, isFullRefund: charge.refunded },
    createdAt: new Date(),
  });

  log.info({
    stripeWebhook: {
      event: "charge.refunded",
      paymentId: payment.paymentId,
      chargeId: charge.id,
      refundAmount,
      isFullRefund: charge.refunded,
      refundRows: refunds.length,
    },
  });
  return { status: "recorded", paymentId: payment.paymentId, refundRows: refunds.length };
}

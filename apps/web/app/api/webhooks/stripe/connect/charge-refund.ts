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
  laterRefundReport,
  providerRefundFromStripe,
  refundCountedByStripe,
} from "@/lib/reservations/stripe-refund-stripe";
import { recordChargeRefunds } from "@/lib/reservations/stripe-refund-writes";
import { fromStripeCents } from "@/lib/stripe";
import { stripe } from "@/lib/stripe/client";

import { findChargePayment, isKnownPaymentIntent } from "./charge-writes";
import { describeWebhookError } from "./webhook-error";
import { type FeeReversalStripe, reverseFeeAtSource, stripeFeeReversal } from "./fee-reversal";

// `charge.refunded` on a connected account (louez-billing design §5.6, docs/api
// fees.md §9 and README Q7): the fee refund at source, then, through the one writer of
// a charge's refunds (lib/reservations/stripe-refund-writes.ts), the payment netted,
// one refund row per Stripe refund of the charge whatever the payment's kind, and the
// refund operation each refund names stated as Stripe states its refund (`pending` while
// Stripe holds it, `succeeded` once it says so).
//
// Stripe counts a refund in the charge's `amount_refunded` from its creation, pending
// or not, and sends `charge.refunded` then: the fee's share of it is given back at
// once. When that refund later fails, Stripe does not take the fee refund back; the
// refund event's own pass through the fee refund raises the billing alert
// `fee_over_returned` (fee-reversal.ts).

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
  /** Runs the credit notes' outbox rows after the commit; the cron sends any left. */
  dispatchEffects: (ids: readonly string[]) => void = () => {},
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
  // What came off the charge, as Stripe counts it: pending refunds included.
  const refunds = listed.filter(refundCountedByStripe);
  const refundedMinor = refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const recorded = await recordChargeRefunds(db, {
    paymentId: payment.paymentId,
    reservationId: payment.reservationId,
    chargeId: charge.id,
    currency,
    amountCapturedMinor: charge.amount_captured,
    refunds: listed,
    source: "stripe_charge_refunded_webhook",
  });
  dispatchEffects(recorded.effectIds);
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
          ...describeWebhookError(error),
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
  | { readonly status: "missing_account" | "payment_not_found" }
  | {
      readonly status: "recorded";
      readonly paymentId: string;
      /** The refund rows made `failed` by this event. */
      readonly undone: number;
    };

/**
 * Handles `refund.failed`, `refund.updated` and `charge.refund.updated`: a refund whose
 * status changed after Stripe made it. Its share of the application fee is reckoned
 * first, as for `charge.refunded`; then the one writer of the charge's refunds runs on
 * the charge's refunds as Stripe lists them now, the later of the event's report and
 * the listing's standing for its own refund (`laterRefundReport`). A refund that
 * succeeded makes its operation `succeeded` (its row was written when Stripe made it);
 * one that failed or was canceled makes its row `failed`, the payment netted again, the
 * operation that asked for it `failed`; one still pending stays as recorded. Each
 * delivered again writes nothing more.
 */
export async function handleRefundUpdated(
  refund: StripeRefundObject & {
    readonly charge?: string | { readonly id: string } | null;
    readonly payment_intent?: string | { readonly id: string } | null;
  },
  accountId: string | undefined,
  port: ChargeRefundStripe = stripeChargeRefund,
  dispatchEffects: (ids: readonly string[]) => void = () => {},
): Promise<RefundUpdatedResult> {
  if (!accountId) {
    log.error({
      stripeWebhook: { event: "refund.updated", issue: "missing_account", refundId: refund.id },
    });
    return { status: "missing_account" };
  }
  const reported = providerRefundFromStripe(refund);
  const chargeId = stripeId(refund.charge ?? null);
  const payment = chargeId
    ? await findChargePayment({
        chargeId,
        paymentIntentId: stripeId(refund.payment_intent ?? null),
        accountId,
      })
    : null;
  if (!chargeId || !payment) {
    log.info({
      stripeWebhook: { event: "refund.updated", issue: "payment_not_found", refundId: refund.id },
    });
    return { status: "payment_not_found" };
  }

  const charge = await port.feeReversal.retrieveCharge(chargeId, accountId);
  if (charge.application_fee) {
    await reverseFeeAtSource({ chargeId, accountId, stripe: port.feeReversal });
  }
  const currency = reported.currency;
  const listed = (await port.listRefunds(chargeId, accountId)).map((candidate) =>
    candidate.id === reported.id
      ? laterRefundReport(listedRefund(candidate, currency), reported)
      : listedRefund(candidate, currency),
  );
  const refunds = listed.some((candidate) => candidate.id === reported.id)
    ? listed
    : [reported, ...listed];
  const recorded = await recordChargeRefunds(db, {
    paymentId: payment.paymentId,
    reservationId: payment.reservationId,
    chargeId,
    currency,
    amountCapturedMinor: charge.amount_captured,
    refunds,
    source: "stripe_refund_updated_webhook",
  });
  dispatchEffects(recorded.effectIds);
  return { status: "recorded", paymentId: payment.paymentId, undone: recorded.undone.length };
}

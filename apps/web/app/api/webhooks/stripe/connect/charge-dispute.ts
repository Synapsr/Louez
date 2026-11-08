import { log } from "@/lib/evlog";
import { clawbackReferrerRewardForQualifyingPayment } from "@/lib/referral/rewards";
import { fromStripeCents } from "@/lib/stripe";

import { recordChargeDispute } from "./charge-writes";
import { type DisputeEventType, type DisputeInput, mapDisputeStatus } from "./dispute-facts";
import { notifyPaymentDisputed } from "./dispute-notification";
import { type FeeReversalStripe, reverseFeeAtSource, stripeFeeReversal } from "./fee-reversal";

// `charge.dispute.*` on a connected account (louez-billing docs/api, fees.md §9 and
// README Q15): the fee refund at source, then the dispute's billing facts.

/** The dispute events that change the money the store keeps (fees.md §9). */
const FEE_REVERSAL_DISPUTE_EVENTS: ReadonlySet<DisputeEventType> = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.closed",
]);

const stripeId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * Every `charge.dispute.*` event updates the dispute's billing facts. The fee refund at
 * source runs first, reading the charge's disputes from Stripe; a reinstatement
 * restores no fee. The referral clawback runs on creation. The owner is told once,
 * by the first event Louez records of an open dispute, whatever its type: Stripe
 * does not order events. Throws when the fee refund fails, so the webhook answers
 * 500 and Stripe retries.
 */
export async function handleChargeDispute(
  input: {
    readonly eventType: DisputeEventType;
    readonly dispute: DisputeInput;
    readonly eventCreatedAt: Date;
    readonly connectedAccountId: string | undefined;
  },
  feeReversal: FeeReversalStripe = stripeFeeReversal,
  notifyDisputed: typeof notifyPaymentDisputed = notifyPaymentDisputed,
): Promise<void> {
  const { eventType, dispute, connectedAccountId } = input;
  const chargeId = stripeId(dispute.charge);
  const paymentIntentId = stripeId(dispute.payment_intent);
  if (chargeId && connectedAccountId && FEE_REVERSAL_DISPUTE_EVENTS.has(eventType)) {
    await reverseFeeAtSource({ chargeId, accountId: connectedAccountId, stripe: feeReversal });
  }
  if (eventType === "charge.dispute.created" && paymentIntentId) {
    // Referral Program: a disputed qualifying payment claws back the Referrer Reward
    // (within the clawback window). Best-effort; never block dispute processing.
    await clawbackReferrerRewardForQualifyingPayment({
      stripePaymentIntentId: paymentIntentId,
    }).catch((error: unknown) => {
      log.error({
        referral: {
          event: "reward_clawback_failed",
          trigger: "dispute",
          disputeId: dispute.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  const result = await recordChargeDispute({
    dispute,
    eventType,
    eventCreatedAt: input.eventCreatedAt,
    accountId: connectedAccountId,
  });
  log.info({
    stripeWebhook: {
      event: eventType,
      disputeId: dispute.id,
      disputeStatus: dispute.status,
      ...(result.recorded
        ? { paymentId: result.paymentId, reservationId: result.reservationId }
        : { issue: result.reason }),
    },
  });

  if (result.recorded && result.opened && mapDisputeStatus(dispute.status).status === "open") {
    await notifyDisputed({
      reservationId: result.reservationId,
      amount: fromStripeCents(dispute.amount, dispute.currency.toUpperCase()),
    });
  }
}

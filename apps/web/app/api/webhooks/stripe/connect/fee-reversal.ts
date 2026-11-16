import { after } from "next/server";
import type Stripe from "stripe";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { createRunLimit, withNamedLock } from "@/lib/billing-sync/locks";
import { reversalAtSource } from "@/lib/billing-sync/money";
import { log } from "@/lib/evlog";
import { recordApplicationFeeRefund } from "@/lib/pay-as-you-go/metering";
import { stripe } from "@/lib/stripe/client";

import { mapDisputeStatus } from "./dispute-facts";

// The fee refund at source (louez-billing docs/api, fees.md §9): the application fee
// follows the money the store keeps. On a refund or a dispute of a charge, Louez reads
// the charge, its fee and its disputes from Stripe under a lock on the charge, and
// refunds the part of the fee the store no longer keeps. Every charge with an
// application fee goes through here, legacy stores included.

/** The Stripe calls of the reversal. The webhook uses `stripeFeeReversal`; tests fake it. */
export type FeeReversalStripe = {
  /** The charge on the connected account. */
  retrieveCharge(
    chargeId: string,
    accountId: string,
  ): Promise<
    Pick<
      Stripe.Charge,
      "id" | "amount" | "amount_captured" | "amount_refunded" | "application_fee" | "payment_intent"
    >
  >;
  /** The fee, on the platform account. */
  retrieveApplicationFee(
    feeId: string,
  ): Promise<Pick<Stripe.ApplicationFee, "id" | "amount" | "amount_refunded" | "currency">>;
  /** Every dispute of the charge, on the connected account. */
  listDisputes(
    chargeId: string,
    accountId: string,
  ): Promise<
    ReadonlyArray<{ readonly id: string; readonly amount: number; readonly status: string }>
  >;
  refundApplicationFee(feeId: string, amountMinor: number, idempotencyKey: string): Promise<void>;
};

const stripeId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

export const stripeFeeReversal: FeeReversalStripe = {
  retrieveCharge: (chargeId, accountId) =>
    stripe.charges.retrieve(chargeId, {}, { stripeAccount: accountId }),
  retrieveApplicationFee: (feeId) => stripe.applicationFees.retrieve(feeId),
  async listDisputes(chargeId, accountId) {
    const disputes: Stripe.Dispute[] = [];
    for await (const dispute of stripe.disputes.list(
      { charge: chargeId, limit: 100 },
      { stripeAccount: accountId },
    ))
      disputes.push(dispute);
    return disputes;
  },
  async refundApplicationFee(feeId, amountMinor, idempotencyKey) {
    await stripe.applicationFees.createRefund(feeId, { amount: amountMinor }, { idempotencyKey });
  },
};

/** Seconds a delivery waits for another one on the same charge (fees.md §9). */
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Reversals at once in this process. Each holds one pooled connection while it waits
 * for the charge's lock and until its ledger write, Stripe calls included. The pool
 * has 10 (packages/db): the rest of the app keeps 6.
 */
export const REVERSALS_AT_ONCE = 4;

/** Milliseconds a delivery waits for its turn before answering 500. */
const TURN_WAIT_MS = 5_000;

const reversalLimit = createRunLimit(REVERSALS_AT_ONCE);

/** In MySQL `'appfee:' || id` is a logical OR: the name is built here. */
export const feeReversalLockName = (chargeId: string) => `appfee:${chargeId}`;

/**
 * Another delivery holds the charge's lock, MySQL failed to take it, or too many
 * reversals run in this process: answer 500.
 */
export class FeeReversalBusyError extends Error {
  constructor(chargeId: string, busy: "lock" | "turn") {
    super(
      busy === "lock"
        ? `the application fee of charge ${chargeId} is being reversed elsewhere; Stripe retries`
        : `too many fee reversals at once for charge ${chargeId}; Stripe retries`,
    );
    this.name = "FeeReversalBusyError";
  }
}

export type FeeReversalResult =
  | { readonly status: "no_fee" }
  | {
      readonly status: "refunded" | "unchanged";
      readonly feeId: string;
      readonly targetMinor: number;
      readonly incrementMinor: number;
      /**
       * The fee given back in all once this call is done, as Stripe counts it. Above
       * `targetMinor` when a refund failed after its share of the fee was given back:
       * Stripe cannot take an application fee refund back.
       */
      readonly feeRefundedMinor: number;
    };

/**
 * The amount Stripe withdrew for disputes: `needs_response`, `under_review` and
 * `lost`, and a status Louez does not know, with an alert. Inquiries, prevented and won
 * disputes count for nothing (README Q15).
 */
function disputedMinor(
  chargeId: string,
  disputes: ReadonlyArray<{
    readonly id: string;
    readonly amount: number;
    readonly status: string;
  }>,
): number {
  let total = 0;
  for (const dispute of disputes) {
    const rule = mapDisputeStatus(dispute.status);
    if (!rule.known)
      log.error(
        "billing",
        `unknown Stripe dispute status "${dispute.status}" on ${dispute.id} (charge ${chargeId}): its amount counts in the fee refund`,
      );
    if (rule.withdrawsFunds && rule.status !== "won") total += Math.max(0, dispute.amount);
  }
  return total;
}

/** A fee given back past its share of what the store no longer keeps, as Stripe counts it. */
type FeeGivenBackInExcess = {
  readonly feeId: string;
  /** Upper case. */
  readonly currency: string;
  readonly feeMinor: number;
  readonly targetMinor: number;
  readonly feeRefundedMinor: number;
};

/**
 * Tells the platform of a fee given back past its share: after a refund failed or a
 * dispute was won, Stripe cannot take it back. The figure is Stripe's and the billing
 * service's, which bills it again for a store it bills; Louez stores none. Runs once
 * the charge's lock and the run's turn are released, since the alert may take a pooled
 * connection. Never throws: the webhook still answers.
 */
async function alertFeeGivenBackInExcess(
  input: { readonly chargeId: string; readonly accountId: string },
  excess: FeeGivenBackInExcess,
  alerts: BillingAlerts | undefined,
): Promise<void> {
  try {
    await (alerts ?? createBillingAlerts({ schedule: after })).alert(
      "fee_over_returned",
      `charge ${input.chargeId} on account ${input.accountId}: application fee ${excess.feeId} of ${excess.feeMinor} ${excess.currency} has ${excess.feeRefundedMinor} given back, above its share of ${excess.targetMinor} by ${excess.feeRefundedMinor - excess.targetMinor} (minor units). Stripe cannot take a fee refund back: the billing service bills it again for a store it bills; for a store Louez's legacy billing bills, check it in Stripe.`,
    );
  } catch (error) {
    log.error(
      "billing",
      `the fee given back in excess on charge ${input.chargeId} could not be alerted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Refunds the part of the charge's application fee the store no longer keeps, then
 * records Stripe's refunded amount on the legacy fee rows, on the lock's connection.
 * When the fee given back is above its share, alerts the platform once the lock is
 * released (`fee_over_returned`). Throws on a Stripe or database error, and
 * `FeeReversalBusyError` when the lock or a turn stays taken, so the webhook answers
 * 500 and Stripe retries: the next delivery reads Stripe again.
 */
export async function reverseFeeAtSource(input: {
  readonly chargeId: string;
  /** The connected account that took the charge, `event.account`. */
  readonly accountId: string;
  readonly stripe?: FeeReversalStripe;
  /** The platform's alerts; tests fake them. */
  readonly alerts?: BillingAlerts;
}): Promise<FeeReversalResult> {
  const port = input.stripe ?? stripeFeeReversal;
  const turn = await reversalLimit(TURN_WAIT_MS, () =>
    withNamedLock(
      feeReversalLockName(input.chargeId),
      LOCK_TIMEOUT_SECONDS,
      async (
        lockedDb,
      ): Promise<{
        readonly result: FeeReversalResult;
        readonly excess: FeeGivenBackInExcess | null;
      }> => {
        const charge = await port.retrieveCharge(input.chargeId, input.accountId);
        const feeId = stripeId(charge.application_fee);
        if (!feeId) return { result: { status: "no_fee" }, excess: null };
        const [fee, disputes] = await Promise.all([
          port.retrieveApplicationFee(feeId),
          port.listDisputes(charge.id, input.accountId),
        ]);

        const { targetMinor, incrementMinor } = reversalAtSource({
          feeMinor: fee.amount,
          feeRefundedMinor: fee.amount_refunded,
          // What the charge took: after a partial capture, `amount` is the
          // authorization, more than the money the fee was taken on.
          chargeMinor: charge.amount_captured,
          refundedMinor: charge.amount_refunded,
          disputedMinor: disputedMinor(charge.id, disputes),
        });
        if (incrementMinor > 0) {
          // The fee refunded before this call is in the key: a refund made elsewhere in
          // between gives the next call a new key instead of an idempotency error.
          await port.refundApplicationFee(
            fee.id,
            incrementMinor,
            `appfee_reverse_${fee.id}_${fee.amount_refunded}_${targetMinor}`,
          );
        }

        const feeRefundedMinor = fee.amount_refunded + incrementMinor;
        await recordApplicationFeeRefund(
          {
            applicationFeeId: fee.id,
            paymentIntentId: stripeId(charge.payment_intent),
            feeRefundedMinor,
          },
          lockedDb,
        );
        return {
          result: {
            status: incrementMinor > 0 ? "refunded" : "unchanged",
            feeId: fee.id,
            targetMinor,
            incrementMinor,
            feeRefundedMinor,
          },
          excess:
            feeRefundedMinor > targetMinor
              ? {
                  feeId: fee.id,
                  currency: fee.currency.toUpperCase(),
                  feeMinor: fee.amount,
                  targetMinor,
                  feeRefundedMinor,
                }
              : null,
        };
      },
    ),
  );
  if (!turn.ran) throw new FeeReversalBusyError(input.chargeId, "turn");
  if (!turn.value.ran) throw new FeeReversalBusyError(input.chargeId, "lock");
  // The lock's connection is back in the pool and the turn is free.
  const { result, excess } = turn.value.value;
  if (excess) await alertFeeGivenBackInExcess(input, excess, input.alerts);
  return result;
}

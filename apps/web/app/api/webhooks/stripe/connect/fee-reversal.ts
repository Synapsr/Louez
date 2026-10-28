import type Stripe from "stripe";

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
    Pick<Stripe.Charge, "id" | "amount" | "amount_refunded" | "application_fee" | "payment_intent">
  >;
  /** The fee, on the platform account. */
  retrieveApplicationFee(
    feeId: string,
  ): Promise<Pick<Stripe.ApplicationFee, "id" | "amount" | "amount_refunded">>;
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

/**
 * Refunds the part of the charge's application fee the store no longer keeps, then
 * records Stripe's refunded amount on the legacy fee rows, on the lock's connection.
 * Throws on a Stripe or database error, and `FeeReversalBusyError` when the lock or a
 * turn stays taken, so the webhook answers 500 and Stripe retries: the next delivery
 * reads Stripe again.
 */
export async function reverseFeeAtSource(input: {
  readonly chargeId: string;
  /** The connected account that took the charge, `event.account`. */
  readonly accountId: string;
  readonly stripe?: FeeReversalStripe;
}): Promise<FeeReversalResult> {
  const port = input.stripe ?? stripeFeeReversal;
  const turn = await reversalLimit(TURN_WAIT_MS, () =>
    withNamedLock(
      feeReversalLockName(input.chargeId),
      LOCK_TIMEOUT_SECONDS,
      async (lockedDb): Promise<FeeReversalResult> => {
        const charge = await port.retrieveCharge(input.chargeId, input.accountId);
        const feeId = stripeId(charge.application_fee);
        if (!feeId) return { status: "no_fee" };
        const [fee, disputes] = await Promise.all([
          port.retrieveApplicationFee(feeId),
          port.listDisputes(charge.id, input.accountId),
        ]);

        const { targetMinor, incrementMinor } = reversalAtSource({
          feeMinor: fee.amount,
          feeRefundedMinor: fee.amount_refunded,
          chargeMinor: charge.amount,
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

        await recordApplicationFeeRefund(
          {
            applicationFeeId: fee.id,
            paymentIntentId: stripeId(charge.payment_intent),
            feeRefundedMinor: fee.amount_refunded + incrementMinor,
          },
          lockedDb,
        );
        return {
          status: incrementMinor > 0 ? "refunded" : "unchanged",
          feeId: fee.id,
          targetMinor,
          incrementMinor,
        };
      },
    ),
  );
  if (!turn.ran) throw new FeeReversalBusyError(input.chargeId, "turn");
  if (!turn.value.ran) throw new FeeReversalBusyError(input.chargeId, "lock");
  return turn.value.value;
}

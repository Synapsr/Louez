import { after } from "next/server";
import type Stripe from "stripe";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { createRunLimit, withNamedLock } from "@/lib/billing-sync/locks";
import { reversalAtSource } from "@/lib/billing-sync/money";
import { log } from "@/lib/evlog";
import { recordApplicationFeeRefund } from "@/lib/pay-as-you-go/metering";
import { stripe } from "@/lib/stripe/client";

import { mapDisputeStatus } from "./dispute-facts";
import { describeWebhookError } from "./webhook-error";

// The fee refund at source (louez-billing docs/api, fees.md §9): the application fee
// follows the money the store keeps. On a refund or a dispute of a charge, Louez reads
// the charge, its fee and its disputes from Stripe under a lock on the charge, and
// refunds the part of the fee the store no longer keeps. Every charge with an
// application fee goes through here, legacy stores included.

/** A read's own timeout and retries, for a read that must not hold its caller long. */
export type FeeReversalReadOptions = {
  readonly timeout: number;
  readonly maxNetworkRetries: number;
};

/**
 * The confirmation's reads of a fee given back in excess: a short timeout and no retry
 * of the SDK's own, as the scheduled pass over abandoned checkouts reads.
 */
export const FEE_EXCESS_CONFIRMATION_READ: FeeReversalReadOptions = {
  timeout: 5_000,
  maxNetworkRetries: 0,
};

/** The Stripe calls of the reversal. The webhook uses `stripeFeeReversal`; tests fake it. */
export type FeeReversalStripe = {
  /** The charge on the connected account. */
  retrieveCharge(
    chargeId: string,
    accountId: string,
    options?: FeeReversalReadOptions,
  ): Promise<
    Pick<
      Stripe.Charge,
      "id" | "amount" | "amount_captured" | "amount_refunded" | "application_fee" | "payment_intent"
    >
  >;
  /** The fee, on the platform account. */
  retrieveApplicationFee(
    feeId: string,
    options?: FeeReversalReadOptions,
  ): Promise<Pick<Stripe.ApplicationFee, "id" | "amount" | "amount_refunded" | "currency">>;
  /** Every dispute of the charge, on the connected account. */
  listDisputes(
    chargeId: string,
    accountId: string,
    options?: FeeReversalReadOptions,
  ): Promise<
    ReadonlyArray<{ readonly id: string; readonly amount: number; readonly status: string }>
  >;
  refundApplicationFee(feeId: string, amountMinor: number, idempotencyKey: string): Promise<void>;
};

const stripeId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

export const stripeFeeReversal: FeeReversalStripe = {
  retrieveCharge: (chargeId, accountId, options) =>
    stripe.charges.retrieve(chargeId, {}, { ...options, stripeAccount: accountId }),
  retrieveApplicationFee: (feeId, options) => stripe.applicationFees.retrieve(feeId, {}, options),
  async listDisputes(chargeId, accountId, options) {
    const disputes: Stripe.Dispute[] = [];
    for await (const dispute of stripe.disputes.list(
      { charge: chargeId, limit: 100 },
      { ...options, stripeAccount: accountId },
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
 * The excess read under the lock is a candidate: the lock keeps other reversals out,
 * not changes at Stripe. A refund made outside Louez that gives back its fee share
 * between the reversal's read of the charge and its read of the fee, or a dispute
 * opened since its read of the disputes, makes the fee look given back past its share.
 * So the fee is read again first, then the disputes, then the charge. The fee given
 * back only grows (Stripe cannot take a fee refund back), and only what raises the
 * share, a refund or a dispute, can land after the fee's read: read last, it raises
 * the share and lowers the excess. What lowers the share, a refund that failed or a
 * dispute won, leaves a real excess. So a change landing between these reads can
 * only lower the excess, never make one up. Read before the fee, the disputes would
 * miss one opened while the fee is read, and give the excess from before it. The
 * disputes are read once more after the charge: if they moved, the reads may mix two
 * pictures, so no alert; the dispute's own event reviews the charge. Only a charge
 * with a candidate pays these four reads, each with a short timeout and no retry. Returns the excess on the fresh figures, or null when they do not
 * confirm it.
 */
/** A charge's disputes, as one comparable string: each id, amount and status. */
const disputePicture = (
  disputes: ReadonlyArray<{
    readonly id: string;
    readonly amount: number;
    readonly status: string;
  }>,
) =>
  disputes
    .map((dispute) => `${dispute.id}:${dispute.amount}:${dispute.status}`)
    .sort()
    .join(",");

async function confirmExcess(
  port: FeeReversalStripe,
  input: { readonly chargeId: string; readonly accountId: string },
  candidate: FeeGivenBackInExcess,
): Promise<FeeGivenBackInExcess | null> {
  const fee = await port.retrieveApplicationFee(candidate.feeId, FEE_EXCESS_CONFIRMATION_READ);
  const disputes = await port.listDisputes(
    input.chargeId,
    input.accountId,
    FEE_EXCESS_CONFIRMATION_READ,
  );
  const charge = await port.retrieveCharge(
    input.chargeId,
    input.accountId,
    FEE_EXCESS_CONFIRMATION_READ,
  );
  const disputesAfter = await port.listDisputes(
    input.chargeId,
    input.accountId,
    FEE_EXCESS_CONFIRMATION_READ,
  );
  if (disputePicture(disputesAfter) !== disputePicture(disputes)) {
    log.debug(
      "billing",
      `the fee given back in excess on charge ${input.chargeId} is not confirmed: its disputes changed while Stripe was read again; the dispute's own event reviews the charge`,
    );
    return null;
  }
  const { targetMinor } = reversalAtSource({
    feeMinor: fee.amount,
    feeRefundedMinor: fee.amount_refunded,
    chargeMinor: charge.amount_captured,
    refundedMinor: charge.amount_refunded,
    disputedMinor: disputedMinor(input.chargeId, disputes),
  });
  if (fee.amount_refunded > targetMinor) {
    return {
      feeId: fee.id,
      currency: fee.currency.toUpperCase(),
      feeMinor: fee.amount,
      targetMinor,
      feeRefundedMinor: fee.amount_refunded,
    };
  }
  log.debug(
    "billing",
    `the fee given back in excess on charge ${input.chargeId} (${candidate.feeRefundedMinor} for a share of ${candidate.targetMinor}) is not confirmed: Stripe now counts ${fee.amount_refunded} for a share of ${targetMinor}`,
  );
  return null;
}

/** `after`, or right away without waiting when there is no request scope. */
const scheduleAfterResponse = (task: () => Promise<void>): void => {
  try {
    after(task);
  } catch {
    void task();
  }
};

/**
 * Tells the platform of a fee given back past its share: after a refund failed or a
 * dispute was won, Stripe cannot take it back. The figure is Stripe's and the billing
 * service's, which bills it again for a store it bills; Louez stores none. Runs as one
 * task after the webhook answered, once the charge's lock and the run's turn are
 * released: the confirmation's reads hold no connection, and the alert may take a
 * pooled one. Never throws: a read that fails or times out raises no alert and logs an
 * error naming the charge.
 */
async function alertFeeGivenBackInExcess(
  port: FeeReversalStripe,
  input: { readonly chargeId: string; readonly accountId: string },
  candidate: FeeGivenBackInExcess,
  alerts: BillingAlerts,
): Promise<void> {
  try {
    const excess = await confirmExcess(port, input, candidate);
    if (!excess) return;
    await alerts.alert(
      "fee_over_returned",
      `charge ${input.chargeId} on account ${input.accountId}: application fee ${excess.feeId} of ${excess.feeMinor} ${excess.currency} has ${excess.feeRefundedMinor} given back, above its share of ${excess.targetMinor} by ${excess.feeRefundedMinor - excess.targetMinor} (minor units). Stripe cannot take a fee refund back: the billing service bills it again for a store it bills; for a store Louez's legacy billing bills, check it in Stripe.`,
      "This is the first fee_over_returned alert this hour: the error log holds every occurrence, each with its charge.",
    );
  } catch (error) {
    alerts.log.error(
      "billing",
      `the fee given back in excess on charge ${input.chargeId} could not be alerted: ${JSON.stringify(describeWebhookError(error))}`,
    );
  }
}

/**
 * Refunds the part of the charge's application fee the store no longer keeps, then
 * records Stripe's refunded amount on the legacy fee rows, on the lock's connection.
 * When the fee given back is above its share, and fresh reads after the webhook
 * answered still say so, alerts the platform (`fee_over_returned`). Throws on a Stripe or database error, and
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
  /** Where the unconfirmed candidate is written: Evlog; tests read it. */
  readonly log?: { warn(tag: string, message: string): void };
  /** Runs the confirmation and the alert once the webhook answered: `after`; tests collect it. */
  readonly schedule?: (task: () => Promise<void>) => void;
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
  if (excess) {
    // On record before anything is deferred, should the process stop before the task.
    (input.log ?? log).warn(
      "billing",
      `unconfirmed fee given back in excess on charge ${input.chargeId} on account ${input.accountId}: application fee ${excess.feeId} of ${excess.feeMinor} ${excess.currency} has ${excess.feeRefundedMinor} given back, above its share of ${excess.targetMinor} by ${excess.feeRefundedMinor - excess.targetMinor} (minor units). A candidate that may be false: the alert fee_over_returned follows once Stripe, read again, confirms it.`,
    );
    // Already in a deferred task: its alert waits for its own Discord part.
    const alerts = input.alerts ?? createBillingAlerts();
    (input.schedule ?? scheduleAfterResponse)(() =>
      alertFeeGivenBackInExcess(port, input, excess, alerts),
    );
  }
  return result;
}

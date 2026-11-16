import Stripe from "stripe";

import { stripe } from "@/lib/stripe/client";
import { classifyStripeFailure } from "@/lib/stripe/request-failure";

// Stripe, as far as a refund of an online payment goes: the charge it comes off, the
// request that makes it, what a failed one tells, and the search for the refund of an
// operation whose answer never came. stripe-refund.ts asks and writes; nothing here
// touches the database.

/** The refund metadata key that carries the id of the operation it answers. */
export const REFUND_OPERATION_METADATA = "louezRefundOperationId";

/** The operation's id is its idempotency key: sent again, Stripe answers for the first. */
export const refundIdempotencyKey = (operationId: string) => `refund:${operationId}`;

/**
 * The longest one Stripe request of a refund may take. Sent once, never retried by
 * the client: a retry is the outbox's, under the same key, after it read the
 * operation's row again.
 */
export const REFUND_REQUEST_TIMEOUT_MS = 20_000;

/** How many pages of a charge's refunds a lookup reads before it gives up. */
export const REFUND_LOOKUP_MAX_PAGES = 5;

const REQUEST_OPTIONS = { timeout: REFUND_REQUEST_TIMEOUT_MS, maxNetworkRetries: 0 } as const;

/** A charge as a refund reads it: the money it took, what was given back, its currency. */
export type RefundCharge = {
  readonly chargeId: string;
  /** After a partial capture, `amount` is the authorization: the money is this. */
  readonly amountCapturedMinor: number;
  /** Refunds that moved money, as Stripe counts them. */
  readonly amountRefundedMinor: number;
  /** Upper case. */
  readonly currency: string;
  /** The card that paid, when Stripe states it: what a person approving the refund is shown. */
  readonly card?: { readonly brand: string; readonly last4: string } | null;
};

/** A refund as Stripe has it. */
export type ProviderRefund = {
  readonly id: string;
  readonly amount: number;
  /** Seconds since the epoch. */
  readonly created: number;
  /** Stripe's own word: read it through `refundStateOf`. */
  readonly status: string | null;
  /** Upper case. */
  readonly currency: string;
  /** Stripe's reason, when it failed. */
  readonly failureReason: string | null;
  /** The operation it answers (`metadata.louezRefundOperationId`); null for any other refund. */
  readonly operationId: string | null;
};

export type RefundRequest = {
  readonly accountId: string;
  readonly chargeId: string;
  readonly amountMinor: number;
  readonly operationId: string;
  readonly reservationId: string;
  readonly reason: "requested_by_customer" | "duplicate" | "fraudulent";
};

/**
 * What Stripe answered a refund. `refused`: Stripe took the request and refunded
 * nothing (an amount past what the charge holds, a charge disputed or already
 * refunded, a balance too low), with Stripe's code. `key_reused`: the key was first
 * sent with other parameters. `indeterminate`: nobody can tell (a timeout, a network
 * error, a Stripe server error, a request with the same key still running, a rate
 * limit, an account Louez cannot reach).
 */
export type RefundAnswer =
  | { readonly kind: "created"; readonly refund: ProviderRefund }
  | { readonly kind: "refused"; readonly code: string | null; readonly message: string }
  | { readonly kind: "key_reused" }
  | { readonly kind: "indeterminate"; readonly replayed: boolean; readonly message: string };

/** The Stripe calls of a refund. The app uses `stripeRefunds`; tests fake it. */
export type StripeRefundPort = {
  /** The charge as it is now, on that account. Throws when it cannot be read. */
  readCharge(accountId: string, chargeId: string): Promise<RefundCharge>;
  /** Never throws: every failure is an answer. */
  createRefund(request: RefundRequest, idempotencyKey: string): Promise<RefundAnswer>;
  /** One page of the charge's refunds on that account, newest first. Throws when it cannot be read. */
  listChargeRefunds(input: {
    readonly accountId: string;
    readonly chargeId: string;
    /** The last refund of the page before; null for the first page. */
    readonly startingAfter: string | null;
  }): Promise<{ readonly refunds: readonly ProviderRefund[]; readonly hasMore: boolean }>;
};

/** What Louez reads of a Stripe refund; `Stripe.Refund` is one. */
export type StripeRefundObject = Pick<
  Stripe.Refund,
  "id" | "amount" | "created" | "status" | "currency"
> & {
  readonly metadata?: Stripe.Metadata | null;
  readonly failure_reason?: string | null;
};

export const providerRefundFromStripe = (refund: StripeRefundObject): ProviderRefund => ({
  id: refund.id,
  amount: refund.amount,
  created: refund.created,
  status: refund.status,
  currency: refund.currency.toUpperCase(),
  failureReason: refund.failure_reason ?? null,
  operationId: refund.metadata?.[REFUND_OPERATION_METADATA] || null,
});

/**
 * A refund as Louez states it, from Stripe's own status. `succeeded`: the money went
 * back. `failed`: Stripe reports it failed or canceled, and it moved nothing. `pending`:
 * anything else (`pending`, `requires_action`, a status Louez does not know): Stripe
 * holds it, the customer has not been refunded yet, and it may still fail.
 */
export type RefundState = "pending" | "succeeded" | "failed";

export const refundStateOf = (refund: Pick<ProviderRefund, "status">): RefundState =>
  refund.status === "succeeded"
    ? "succeeded"
    : refund.status === "failed" || refund.status === "canceled"
      ? "failed"
      : "pending";

/**
 * Whether Stripe counts the refund in the charge's `amount_refunded`: from its creation,
 * pending or not, until it fails or is canceled.
 */
export const refundCountedByStripe = (refund: Pick<ProviderRefund, "status">): boolean =>
  refundStateOf(refund) !== "failed";

/**
 * The later of two reports of one refund. Stripe moves a refund from pending to
 * succeeded, failed or canceled, and one that succeeded may fail afterwards, never the
 * other way: whichever arrives last, the report further along wins.
 */
export const laterRefundReport = (a: ProviderRefund, b: ProviderRefund): ProviderRefund => {
  const rank = { pending: 0, succeeded: 1, failed: 2 } as const;
  return rank[refundStateOf(b)] > rank[refundStateOf(a)] ? b : a;
};

export const stripeRefunds: StripeRefundPort = {
  async readCharge(accountId, chargeId) {
    const charge = await stripe.charges.retrieve(
      chargeId,
      {},
      { stripeAccount: accountId, ...REQUEST_OPTIONS },
    );
    const card = charge.payment_method_details?.card;
    return {
      chargeId: charge.id,
      amountCapturedMinor: charge.amount_captured,
      amountRefundedMinor: charge.amount_refunded,
      currency: charge.currency.toUpperCase(),
      card: card?.brand && card.last4 ? { brand: card.brand, last4: card.last4 } : null,
    };
  },

  /**
   * The application fee is not refunded here: the Connect webhook's `charge.refunded`
   * refunds the part of it the store no longer keeps, disputes counted
   * (app/api/webhooks/stripe/connect/fee-reversal.ts). Asked here too, it would be
   * refunded by two rules, Stripe's proportion and Louez's.
   */
  async createRefund(request, idempotencyKey) {
    try {
      const refund = await stripe.refunds.create(
        {
          charge: request.chargeId,
          amount: request.amountMinor,
          reason: request.reason,
          metadata: {
            [REFUND_OPERATION_METADATA]: request.operationId,
            reservationId: request.reservationId,
          },
        },
        { stripeAccount: request.accountId, idempotencyKey, ...REQUEST_OPTIONS },
      );
      return { kind: "created", refund: providerRefundFromStripe(refund) };
    } catch (error) {
      const failure = classifyStripeFailure(error);
      if (failure.kind !== "refused") return failure;
      const code = error instanceof Stripe.errors.StripeError ? (error.code ?? null) : null;
      return { kind: "refused", code, message: failure.message };
    }
  },

  async listChargeRefunds({ accountId, chargeId, startingAfter }) {
    const page = await stripe.refunds.list(
      { charge: chargeId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      { stripeAccount: accountId, ...REQUEST_OPTIONS },
    );
    return { refunds: page.data.map(providerRefundFromStripe), hasMore: page.has_more };
  },
};

/** The charge as Stripe states it now, with every refund it lists; null when not all could be read. */
export type ChargeSnapshot = {
  readonly charge: RefundCharge;
  readonly refunds: readonly ProviderRefund[] | null;
};

/** Reads the charge, then all its refunds, on the account the operation was sent to. Throws when a read fails. */
export async function readChargeSnapshot(
  port: Pick<StripeRefundPort, "readCharge" | "listChargeRefunds">,
  input: { readonly accountId: string; readonly chargeId: string },
): Promise<ChargeSnapshot> {
  const charge = await port.readCharge(input.accountId, input.chargeId);
  const refunds = await listAllChargeRefunds(port, input);
  return { charge, refunds };
}

export type RefundLookup =
  | { readonly kind: "found"; readonly refund: ProviderRefund }
  /**
   * Stripe's own account of the charge holds no refund of the operation: its listing
   * was read to its end, none names the operation, and the refunds it lists that
   * Stripe counts (pending or succeeded) add up to what the charge says was refunded, so no refund exists
   * that the listing does not show.
   */
  | { readonly kind: "absent" }
  /** The listing is incomplete, or does not add up to the charge: it says nothing. */
  | { readonly kind: "unknown" };

/** What a snapshot of the charge says of the operation's refund, by its id in the refund's metadata. */
export function lookUpOperationRefund(snapshot: ChargeSnapshot, operationId: string): RefundLookup {
  if (!snapshot.refunds) return { kind: "unknown" };
  const refund = snapshot.refunds.find((candidate) => candidate.operationId === operationId);
  if (refund) return { kind: "found", refund };
  const listedMinor = snapshot.refunds
    .filter(refundCountedByStripe)
    .reduce((sum, candidate) => sum + candidate.amount, 0);
  return listedMinor === snapshot.charge.amountRefundedMinor
    ? { kind: "absent" }
    : { kind: "unknown" };
}

/**
 * Every refund of the charge, for the writer that nets the payment: null when the
 * listing could not be read to its end within the page bound.
 */
export async function listAllChargeRefunds(
  port: Pick<StripeRefundPort, "listChargeRefunds">,
  input: { readonly accountId: string; readonly chargeId: string },
): Promise<readonly ProviderRefund[] | null> {
  const all: ProviderRefund[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < REFUND_LOOKUP_MAX_PAGES; page++) {
    const { refunds, hasMore } = await port.listChargeRefunds({ ...input, startingAfter });
    all.push(...refunds);
    if (!hasMore) return all;
    const last = refunds.at(-1);
    if (!last) return null;
    startingAfter = last.id;
  }
  return null;
}

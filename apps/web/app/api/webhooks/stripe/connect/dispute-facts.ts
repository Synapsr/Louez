import type Stripe from "stripe";

// Stripe disputes as billing facts (louez-billing docs/api, README Q15, openapi
// `Dispute`). Only disputes whose funds Stripe withdrew reach the billing service:
// the snapshot builder skips rows whose `openedAt` is null.

export type DisputeStatus = "open" | "won" | "lost";

export type DisputeEventType =
  | "charge.dispute.created"
  | "charge.dispute.updated"
  | "charge.dispute.closed"
  | "charge.dispute.funds_withdrawn"
  | "charge.dispute.funds_reinstated";

/** The fields of a Stripe dispute the webhook reads. */
export type DisputeInput = Pick<
  Stripe.Dispute,
  "id" | "amount" | "currency" | "created" | "charge" | "payment_intent"
> & {
  /** A string, since older API versions also return `charge_refunded`. */
  readonly status: string;
  readonly balance_transactions: ReadonlyArray<
    Pick<Stripe.BalanceTransaction, "amount" | "created">
  >;
};

type StatusRule = {
  readonly status: DisputeStatus;
  /** Stripe takes the disputed funds in this status (fees.md §9). */
  readonly withdrawsFunds: boolean;
  /** 0 inquiry, 1 open chargeback, 2 closed. Stripe never moves a dispute back. */
  readonly stage: 0 | 1 | 2;
};

// Inquiries, prevented disputes and `charge_refunded` withdraw nothing and are
// never sent. Their status column says whether the store still risks the money:
// open while Stripe may escalate the inquiry, won once it is closed.
const STATUS_RULES = new Map<string, StatusRule>([
  ["warning_needs_response", { status: "open", withdrawsFunds: false, stage: 0 }],
  ["warning_under_review", { status: "open", withdrawsFunds: false, stage: 0 }],
  ["needs_response", { status: "open", withdrawsFunds: true, stage: 1 }],
  ["under_review", { status: "open", withdrawsFunds: true, stage: 1 }],
  ["won", { status: "won", withdrawsFunds: true, stage: 2 }],
  ["lost", { status: "lost", withdrawsFunds: true, stage: 2 }],
  ["warning_closed", { status: "won", withdrawsFunds: false, stage: 2 }],
  ["prevented", { status: "won", withdrawsFunds: false, stage: 2 }],
  ["charge_refunded", { status: "won", withdrawsFunds: false, stage: 2 }],
]);

// README Q15: a status Louez does not know counts as open, and Louez alerts.
const UNKNOWN_STATUS: StatusRule = { status: "open", withdrawsFunds: true, stage: 1 };

export function mapDisputeStatus(stripeStatus: string): StatusRule & { readonly known: boolean } {
  const rule = STATUS_RULES.get(stripeStatus);
  return rule ? { ...rule, known: true } : { ...UNKNOWN_STATUS, known: false };
}

export type DisputeFacts = {
  readonly disputeId: string;
  readonly chargeId: string;
  readonly paymentIntentId: string | null;
  readonly amountMinor: number;
  /** Upper case. */
  readonly currency: string;
  readonly status: DisputeStatus;
  readonly stripeStatus: string;
  readonly knownStatus: boolean;
  /** When Stripe withdrew the funds; null while it has not. */
  readonly openedAt: Date | null;
  /** When the dispute closed won or lost. */
  readonly closedAt: Date | null;
};

const fromUnix = (seconds: number) => new Date(seconds * 1000);

const stripeId = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

function earliest(times: readonly number[]): number | null {
  return times.length === 0 ? null : Math.min(...times);
}

/** The dispute as one event shows it. `eventCreatedAt` is the event's `created`. */
export function readDisputeFacts(input: {
  readonly dispute: DisputeInput;
  readonly eventType: DisputeEventType;
  readonly eventCreatedAt: Date;
}): DisputeFacts {
  const { dispute, eventType, eventCreatedAt } = input;
  const rule = mapDisputeStatus(dispute.status);
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;

  // The balance transactions are the withdrawal (negative) and the reinstatement
  // (positive) on the connected account.
  const withdrawal = earliest(
    dispute.balance_transactions.filter((tx) => tx.amount < 0).map((tx) => tx.created),
  );
  const reinstatement = earliest(
    dispute.balance_transactions.filter((tx) => tx.amount > 0).map((tx) => tx.created),
  );

  let openedAt: Date | null = null;
  if (rule.withdrawsFunds) {
    if (withdrawal !== null) openedAt = fromUnix(withdrawal);
    else if (eventType === "charge.dispute.funds_withdrawn") openedAt = eventCreatedAt;
    else if (!rule.known) openedAt = fromUnix(dispute.created);
  }

  let closedAt: Date | null = null;
  if (rule.stage === 2) {
    closedAt =
      dispute.status === "won" && reinstatement !== null ? fromUnix(reinstatement) : eventCreatedAt;
  }

  return {
    disputeId: dispute.id,
    chargeId,
    paymentIntentId: stripeId(dispute.payment_intent),
    amountMinor: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    status: rule.status,
    // The column holds 32 characters; an unknown status stays unknown when cut.
    stripeStatus: dispute.status.slice(0, 32),
    knownStatus: rule.known,
    openedAt,
    closedAt,
  };
}

export type StoredDispute = {
  readonly status: DisputeStatus;
  readonly stripeStatus: string;
  readonly openedAt: Date | null;
  readonly closedAt: Date | null;
};

export type DisputeRowValues = StoredDispute & {
  readonly amountMinor: number;
  readonly currency: string;
};

/**
 * The row after one event. Stripe can deliver events out of order, and a dispute
 * never moves back a stage, so an older event never reopens a closed dispute.
 * The withdrawal and close times are kept once known.
 */
export function mergeDispute(
  existing: StoredDispute | null,
  incoming: DisputeFacts,
): DisputeRowValues {
  const keepStatus =
    existing !== null &&
    mapDisputeStatus(existing.stripeStatus).stage > mapDisputeStatus(incoming.stripeStatus).stage;
  return {
    amountMinor: incoming.amountMinor,
    currency: incoming.currency,
    status: keepStatus ? existing.status : incoming.status,
    stripeStatus: keepStatus ? existing.stripeStatus : incoming.stripeStatus,
    openedAt: existing?.openedAt ?? incoming.openedAt,
    closedAt: existing?.closedAt ?? (keepStatus ? null : incoming.closedAt),
  };
}

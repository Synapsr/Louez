import { ORPCError } from "@orpc/client";

import type { Reservation } from "@louez/api/contracts/reservations";
import { hundredthsOf } from "@louez/api/services/payment-amount";

import { isRefundRow, isStripeRefundRow } from "@/lib/reservations/util.payment-status";

/** A payment row as `reservations.get` gives it: all the page knows of a payment. */
export type ReservationPayment = Reservation["payments"][number];

/**
 * A payment row, as far as refunding it through Stripe goes: only what `reservations.get`
 * gives, so a field it does not give is a type error rather than a value always missing.
 */
export type StripeRefundRow = Pick<
  ReservationPayment,
  | "id"
  | "amount"
  | "type"
  | "method"
  | "status"
  | "refundOfPaymentId"
  | "stripeRefundId"
  | "stripePaymentIntentId"
  | "stripeCheckoutSessionId"
  | "sessionSettledAt"
>;

/** A refund asked through Louez, as the reservation states it (`reservation.refunds`). */
export interface StripeRefundOperation {
  id: string;
  paymentId: string;
  refundPaymentId: string | null;
  status: "pending" | "succeeded" | "failed";
  amount: string;
  createdAt: Date | string;
  failure: { code: string; message: string | null } | null;
}

/** A dispute on one of the reservation's payments (`reservation.disputes`). */
export interface StripePaymentDispute {
  paymentId: string;
  status: "open" | "won" | "lost";
}

export interface StripeRefundContext {
  payments: readonly StripeRefundRow[];
  refunds: readonly StripeRefundOperation[];
  disputes: readonly StripePaymentDispute[];
  /** The member's role allows refunds (`write`, as recording a refund given by hand). */
  canRefund: boolean;
}

/** Why a refund is offered but cannot be sent yet. */
export type StripeRefundBlock = "disputed" | "not_settled" | "no_permission";

export type StripeRefundAvailability =
  | { state: "hidden" }
  | { state: "disabled"; reason: StripeRefundBlock }
  | { state: "available" };

/** The money a store takes online and may give back through Stripe. */
const REFUNDABLE_TYPES = new Set(["rental", "damage", "adjustment", "deposit_capture"]);

/**
 * What the payment can still give back, as the page counts it, in hundredths of its
 * currency: the row's amount (Stripe's refunds already come off it), less the refunds
 * the store gave by hand against it and the refunds still being sent (asked, with no row
 * of their own yet). The dialog reads the exact figure from Stripe before anything is sent.
 */
export function stripeRefundRemaining(
  payment: StripeRefundRow,
  context: Pick<StripeRefundContext, "payments" | "refunds">,
): number {
  const byHand = context.payments
    .filter(
      (row) =>
        row.refundOfPaymentId === payment.id &&
        row.status === "completed" &&
        !isStripeRefundRow(row),
    )
    .reduce((sum, row) => sum + hundredthsOf(row.amount), 0);
  const inFlight = context.refunds
    .filter(
      (refund) =>
        refund.paymentId === payment.id &&
        refund.status === "pending" &&
        refund.refundPaymentId === null,
    )
    .reduce((sum, refund) => sum + hundredthsOf(refund.amount), 0);
  return hundredthsOf(payment.amount) - byHand - inFlight;
}

/**
 * Whether a row offers "Refund", and whether it can be sent now. Hidden on what is not
 * money taken online, on a refund row, a hold, a failed or cancelled payment, a payment
 * refunded in full or whose remainder refunds in progress hold, and on a checkout never
 * paid. Shown but blocked while a dispute is open, while the payment is still pending at
 * Stripe (its PaymentIntent exists), and for a role that may not refund. A completed
 * payment whose charge Stripe has not settled is refused by the dialog's read of it
 * (`PAYMENT_NOT_SETTLED`): the page is not given Stripe's charge.
 */
export function stripeRefundAvailability(
  payment: StripeRefundRow,
  context: StripeRefundContext,
): StripeRefundAvailability {
  if (payment.method !== "stripe" || !REFUNDABLE_TYPES.has(payment.type)) {
    return { state: "hidden" };
  }
  if (isRefundRow(payment)) return { state: "hidden" };
  if (payment.status === "pending") {
    const inMotion = Boolean(payment.stripePaymentIntentId) && !payment.sessionSettledAt;
    return inMotion ? { state: "disabled", reason: "not_settled" } : { state: "hidden" };
  }
  if (payment.status !== "completed") return { state: "hidden" };
  if (stripeRefundRemaining(payment, context) <= 0) return { state: "hidden" };
  if (
    context.disputes.some(
      (dispute) => dispute.paymentId === payment.id && dispute.status === "open",
    )
  ) {
    return { state: "disabled", reason: "disputed" };
  }
  if (!context.canRefund) return { state: "disabled", reason: "no_permission" };
  return { state: "available" };
}

/** A payment type's key among `payment.types`. */
const PAYMENT_TYPE_KEYS: Record<string, string> = {
  rental: "rental",
  deposit: "deposit",
  deposit_return: "depositReturn",
  damage: "damage",
  deposit_hold: "depositHold",
  deposit_capture: "depositCapture",
  adjustment: "adjustment",
};

export const paymentTypeKey = (type: string) => PAYMENT_TYPE_KEYS[type] ?? "adjustment";

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

/** A card brand as Stripe names it (`visa`), as people write it (`Visa`). */
export const cardBrandLabel = (brand: string) => CARD_BRANDS[brand] ?? brand;

/** A row Stripe holds a payment for, by its PaymentIntent, which its dashboard can open. */
export const opensInStripe = (payment: StripeRefundRow) =>
  payment.method === "stripe" && Boolean(payment.stripePaymentIntentId);

/** The refunds still waiting for Stripe's final word: the page reads each again. */
export const pendingStripeRefunds = (refunds: readonly StripeRefundOperation[]) =>
  refunds.filter((refund) => refund.status === "pending");

/** Why a refund failed, in words the store reads (`payment.stripeRefund.failures.*`). */
export type StripeRefundFailureKey =
  | "disputed"
  | "balance"
  | "card"
  | "alreadyRefunded"
  | "notMade"
  | "canceled"
  | "generic";

const FAILURES: Record<string, StripeRefundFailureKey> = {
  charge_disputed: "disputed",
  charge_for_pending_refund_disputed: "disputed",
  balance_insufficient: "balance",
  insufficient_funds: "balance",
  declined: "card",
  expired_or_canceled_card: "card",
  lost_or_stolen_card: "card",
  charge_already_refunded: "alreadyRefunded",
  not_found_at_stripe: "notMade",
  merchant_request: "canceled",
  canceled: "canceled",
};

/** Stripe's or Louez's failure code, as one of the store's reasons; any other is generic. */
export const stripeRefundFailureKey = (code: string): StripeRefundFailureKey =>
  FAILURES[code] ?? "generic";

/**
 * The failure a row shows: on a refund row that failed, its refund's; on a payment, the
 * latest refund asked for it, when Stripe made none (no row of its own shows it).
 */
export function stripeRefundFailureOf(
  payment: StripeRefundRow,
  refunds: readonly StripeRefundOperation[],
): StripeRefundFailureKey | null {
  const own = refunds.find((refund) => refund.refundPaymentId === payment.id);
  if (own) return own.failure ? stripeRefundFailureKey(own.failure.code) : null;
  const latest = refunds
    .filter((refund) => refund.paymentId === payment.id)
    .reduce<StripeRefundOperation | null>(
      (last, refund) =>
        !last || new Date(refund.createdAt).getTime() >= new Date(last.createdAt).getTime()
          ? refund
          : last,
      null,
    );
  if (!latest || latest.refundPaymentId !== null || !latest.failure) return null;
  return stripeRefundFailureKey(latest.failure.code);
}

/** A refusal of the refund, its preview or the Stripe link, as the dialog words it. */
export type StripeRefundRefusal =
  | { key: "exceedsRefundable"; refundable: string; currency: string }
  | { key: "currencyNotSupported"; currency: string }
  | {
      key: "repeatUnconfirmed";
      /** When the same amount was refunded (ISO 8601). */
      refundedAt: string;
      /** Who refunded it; null when no person is known. */
      by: string | null;
      amount: string;
      currency: string;
    }
  | {
      key:
        | "disputed"
        | "notSettled"
        | "notRefundable"
        | "chargeShared"
        | "noStripeAccount"
        | "amountInvalid"
        | "takenByHand"
        | "notFound"
        | "stripeUnavailable"
        | "permission"
        | "demo"
        | "notInStripe"
        | "stripeNotConfigured"
        | "alreadyInProgress"
        | "inProgress"
        | "outcomeUnknown"
        | "generic";
    };

const SIMPLE_REFUSALS = {
  PAYMENT_DISPUTED: "disputed",
  PAYMENT_NOT_SETTLED: "notSettled",
  PAYMENT_NOT_REFUNDABLE: "notRefundable",
  PAYMENT_CHARGE_SHARED: "chargeShared",
  NO_STRIPE_ACCOUNT: "noStripeAccount",
  REFUND_AMOUNT_INVALID: "amountInvalid",
  REFUND_PAYMENT_TAKEN_BY_HAND: "takenByHand",
  PAYMENT_NOT_FOUND: "notFound",
  STRIPE_UNAVAILABLE: "stripeUnavailable",
  PERMISSION_DENIED: "permission",
  NO_STORE_ACCESS: "permission",
  DEMO_STORE_REFUSED: "demo",
  PAYMENT_NOT_IN_STRIPE: "notInStripe",
  STRIPE_NOT_CONFIGURED: "stripeNotConfigured",
  REFUND_ALREADY_IN_PROGRESS: "alreadyInProgress",
  OPERATION_IN_PROGRESS: "inProgress",
  OPERATION_OUTCOME_UNKNOWN: "outcomeUnknown",
} as const;

/** The platform's answers about a key whose first call is still running or ended unknown. */
const OUTCOME_UNKNOWN_CODES = new Set(["OPERATION_IN_PROGRESS", "OPERATION_OUTCOME_UNKNOWN"]);

const isSimpleRefusal = (code: string): code is keyof typeof SIMPLE_REFUSALS =>
  Object.hasOwn(SIMPLE_REFUSALS, code);

const text = (value: unknown) => (typeof value === "string" ? value : null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** An API error's code and facts (`data.code`, `data.details`); none for anything else. */
function apiErrorFacts(error: unknown): { code: string | null; details: Record<string, unknown> } {
  if (!(error instanceof ORPCError) || !isRecord(error.data)) return { code: null, details: {} };
  const { code, details } = error.data;
  return { code: text(code), details: isRecord(details) ? details : {} };
}

/** A refusal of the refund, its preview or the Stripe link, by its code and facts. */
export function stripeRefundRefusalOf(error: unknown): StripeRefundRefusal {
  const { code, details } = apiErrorFacts(error);
  if (!code) return { key: "generic" };
  if (code === "REFUND_EXCEEDS_REFUNDABLE") {
    const refundable = text(details.refundable);
    const currency = text(details.currency);
    return refundable && currency
      ? { key: "exceedsRefundable", refundable, currency }
      : { key: "generic" };
  }
  if (code === "REFUND_REPEAT_UNCONFIRMED") {
    const refundedAt = text(details.refundedAt);
    const amount = text(details.amount);
    const currency = text(details.currency);
    return refundedAt && amount && currency
      ? { key: "repeatUnconfirmed", refundedAt, by: text(details.by), amount, currency }
      : { key: "generic" };
  }
  if (code === "REFUND_CURRENCY_NOT_SUPPORTED") {
    const currency = text(details.currency);
    return currency ? { key: "currencyNotSupported", currency } : { key: "generic" };
  }
  return isSimpleRefusal(code) ? { key: SIMPLE_REFUSALS[code] } : { key: "generic" };
}

/**
 * What a failed send says of its refund. Only a refusal by a code Louez words (answered
 * before anything is written) proves nothing was refunded: the person may send again
 * freely. Anything else (a call still running, an outcome the platform could not record,
 * a code it does not know, no answer at all) may hide a refund: an outcome not known, to
 * check in the payment history.
 */
export function stripeRefundSendFailure(error: unknown): {
  known: boolean;
  refusal: StripeRefundRefusal;
} {
  const { code } = apiErrorFacts(error);
  const refusal = stripeRefundRefusalOf(error);
  if (code && !OUTCOME_UNKNOWN_CODES.has(code) && refusal.key !== "generic") {
    return { known: true, refusal };
  }
  return {
    known: false,
    refusal: { key: code === "OPERATION_IN_PROGRESS" ? "inProgress" : "outcomeUnknown" },
  };
}

/**
 * What a send of the dialog asks, for its idempotency key: the same values sent again
 * from the same dialog are the same request, and replay.
 */
export const stripeRefundAttemptOf = (input: {
  paymentId: string;
  amount: string;
  reason?: string;
  notes?: string;
  confirmRepeat?: boolean;
}) =>
  JSON.stringify([
    input.paymentId,
    input.amount,
    input.reason ?? null,
    input.notes?.trim() ?? "",
    input.confirmRepeat === true,
  ]);

/** The key of a send: the previous one while its values stay the same, else a new one. */
export function stripeRefundKeyFor(
  previous: { attempt: string; key: string } | null,
  attempt: string,
  newKey: () => string,
): { attempt: string; key: string } {
  return previous && previous.attempt === attempt ? previous : { attempt, key: newKey() };
}

/** The analytics outcome of a send: the refund's state, or the refusal's code. */
export function stripeRefundOutcomeOf(
  result: { status: "pending" | "succeeded" | "failed" } | { error: unknown },
): string {
  if ("status" in result) return result.status;
  return apiErrorFacts(result.error).code ?? "error";
}

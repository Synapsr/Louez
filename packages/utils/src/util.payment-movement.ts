/**
 * The cash ledger's reading of a `payments` row (dashboard → Finances).
 *
 * Every amount is stored positive (only an `adjustment` may be negative), so
 * the direction of the money comes from what the row is, never from its sign.
 * `packages/api/src/services/finances.ts` applies the same rule in SQL: change
 * one, change the other.
 */

export interface StripeRefundIds {
  stripeRefundId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
}

/**
 * A Stripe refund is its own positive row: it carries the refund id and none of
 * the ids a charge is created with. The refund id alone is not enough, since
 * older webhooks also stamped it on the refunded charge. Both charge ids must be
 * loaded and empty: a caller that did not select them never loses a receipt.
 */
export const isStripeRefundRow = (payment: StripeRefundIds): boolean =>
  Boolean(payment.stripeRefundId) &&
  payment.stripePaymentIntentId === null &&
  payment.stripeCheckoutSessionId === null;

export const PAYMENT_MOVEMENT_NATURES = [
  "rental",
  "deposit",
  "deposit_hold",
  "deposit_capture",
  "deposit_return",
  "refund",
  "damage",
  "adjustment",
] as const;

/** What the row is to the person closing the till, refunds told apart from receipts. */
export type PaymentMovementNature = (typeof PAYMENT_MOVEMENT_NATURES)[number];

/** Mirrors the `payment_type` enum of the database. */
export type PaymentMovementType = Exclude<PaymentMovementNature, "refund">;

export interface PaymentMovementRow extends StripeRefundIds {
  type: PaymentMovementType;
  status: string;
  amount: string | number;
  refundOfPaymentId?: string | null;
}

export interface PaymentMovementContext {
  /** A completed `deposit_capture` exists on the same reservation. */
  depositCaptured?: boolean;
  /** Sum of the completed Stripe refund rows pointing at this row. */
  linkedStripeRefunds?: number;
}

export type PaymentMovement =
  /** Failed, cancelled, or a hold whose money is carried by its capture row. */
  | { kind: "ignored" }
  /** Listed with a status badge, never part of a total. `held` is an authorisation, not cash. */
  | { kind: "unsettled"; state: "pending" | "held"; nature: PaymentMovementNature; amount: number }
  /** Cash that moved. `amount` is signed: positive came in, negative went out. */
  | { kind: "settled"; direction: "in" | "out"; nature: PaymentMovementNature; amount: number };

const toAmount = (value: string | number): number => {
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
};

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

/** A row that refunds another one, by hand (`refundOfPaymentId`) or through Stripe. */
const isRefundOfPayment = (payment: PaymentMovementRow): boolean =>
  Boolean(payment.refundOfPaymentId) || isStripeRefundRow(payment);

export const getPaymentMovementNature = (payment: PaymentMovementRow): PaymentMovementNature => {
  // A deposit given back reads better as such than as a generic refund, even
  // when it is recorded as the refund of a capture.
  if (payment.type === "deposit_return") return "deposit_return";
  return isRefundOfPayment(payment) ? "refund" : payment.type;
};

/**
 * Ledger rule:
 *
 * - ignored: a status other than `completed` / `refunded`, or a completed
 *   `deposit_hold` once a `deposit_capture` carries the amount really taken;
 * - money out: a manual refund, a Stripe refund row, or a `deposit_return`;
 * - money in: everything else, at its gross amount. The Stripe webhook brings a
 *   refunded charge down to its net amount, so the refund rows linked to it are
 *   added back: 100 refunded by 30 reads +100 then −30, not +70 then −30.
 *
 * Known limit: a Stripe refund row written before refunds were linked to their
 * charge, and that the backfill could not attach, still counts as money out but
 * its charge keeps its net amount — the day's receipts read low by that refund.
 */
export const classifyPaymentMovement = (
  payment: PaymentMovementRow,
  { depositCaptured = false, linkedStripeRefunds = 0 }: PaymentMovementContext = {},
): PaymentMovement => {
  const nature = getPaymentMovementNature(payment);
  const amount = toAmount(payment.amount);

  if (payment.status === "pending" || payment.status === "authorized") {
    return {
      kind: "unsettled",
      state: payment.status === "authorized" ? "held" : "pending",
      nature,
      amount: roundMoney(Math.abs(amount)),
    };
  }

  if (payment.status !== "completed" && payment.status !== "refunded") return { kind: "ignored" };
  if (payment.type === "deposit_hold" && payment.status === "completed" && depositCaptured) {
    return { kind: "ignored" };
  }

  if (isRefundOfPayment(payment) || payment.type === "deposit_return") {
    return { kind: "settled", direction: "out", nature, amount: -roundMoney(Math.abs(amount)) };
  }

  const gross = roundMoney(amount + linkedStripeRefunds);
  // Only an adjustment can be negative: a price cut given back to the customer.
  return { kind: "settled", direction: gross < 0 ? "out" : "in", nature, amount: gross };
};

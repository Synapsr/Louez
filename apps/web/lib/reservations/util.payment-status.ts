/**
 * One reading of a reservation's payments, shared by the account list and
 * the reservation page. "Paid" means the rental itself is settled: a
 * completed `rental` payment. Deposits, holds and refunds never count.
 */

import {
  getRentalPaid,
  getSettledPaymentAmount,
  isCustomerDepositHoldRow,
  isPaymentInCurrency,
  isStripeRefundRow,
} from "@louez/utils";

export interface PaymentLike {
  id?: string;
  type: string;
  status: string;
  amount: string | number;
  /** Set on the row that gives money back for another row. */
  refundOfPaymentId?: string | null;
  /** Stripe ids: together they tell a Stripe refund row from the charge it refunds. */
  stripeRefundId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  /** With `currency`, tells a Stripe payment, whose currency is its own. */
  method?: string;
  currency?: string | null;
  /** On a hold Louez decided against, until the provider released it. */
  releaseOwedAt?: Date | string | null;
}

export type ReservationPaymentStatus = "paid" | "processing" | "unpaid";

// One in-memory definition of a Stripe refund row, shared with the cash ledger.
export { isStripeRefundRow };

/** A row that gives money back: a refund of another row, or a deposit return. */
export const isRefundRow = (payment: PaymentLike): boolean =>
  Boolean(payment.refundOfPaymentId) ||
  isStripeRefundRow(payment) ||
  payment.type === "deposit_return";

/**
 * A refund that gave nothing back: Stripe reported it failed or canceled. Its row counts
 * for nothing, and is never shown as money given back.
 */
export const isFailedRefundRow = (payment: PaymentLike): boolean =>
  isRefundRow(payment) && (payment.status === "failed" || payment.status === "cancelled");

/** Stripe's word on a refund asked through Louez, by the refund row it made (`reservation.refunds`). */
export type RefundStatusByRow = ReadonlyMap<string, "pending" | "succeeded" | "failed">;

export const refundStatusByRow = (
  refunds: readonly {
    refundPaymentId: string | null;
    status: "pending" | "succeeded" | "failed";
  }[],
): RefundStatusByRow =>
  new Map(
    refunds.flatMap((refund) =>
      refund.refundPaymentId ? [[refund.refundPaymentId, refund.status] as const] : [],
    ),
  );

/**
 * What a payment row is, for whoever shows it: money the store took (`receipt`), a card
 * hold (`hold`), or money given back (`refund`, by hand or through Stripe, in each of its
 * shapes, `isRefundRow`). Louez counts a refund as Stripe counts it (its row is `completed`
 * from the moment Stripe made it) but states it made only when it knows: a refund is
 * `failed` when it gave nothing back; `processing` while the operation Louez asked it with
 * waits for Stripe's final word; `done` once that operation succeeded, or when the store
 * recorded it by hand (its own word); `issued` for a Stripe refund no operation of Louez's
 * follows (made in Stripe's own dashboard, by the extension, or before operations existed):
 * Stripe made it, and nothing stored says whether it settled. The one reading of the
 * payment card, the history and the customer's page; the totals read the rows by their own
 * rules.
 */
export type RefundState = "done" | "issued" | "processing" | "failed";

export type PaymentRowReading =
  | { kind: "receipt" }
  | { kind: "hold" }
  | { kind: "refund"; state: RefundState };

/** A refund that went through Stripe, in any of its shapes. */
const isStripeRefund = (payment: PaymentLike) =>
  payment.method === "stripe" || isStripeRefundRow(payment);

export const readPaymentRow = (
  payment: PaymentLike,
  refundStatuses: RefundStatusByRow = new Map(),
): PaymentRowReading => {
  if (payment.type === "deposit_hold") return { kind: "hold" };
  if (!isRefundRow(payment)) return { kind: "receipt" };
  const stated = payment.id ? refundStatuses.get(payment.id) : undefined;
  if (isFailedRefundRow(payment) || stated === "failed") return { kind: "refund", state: "failed" };
  if (stated === "pending" || payment.status === "pending") {
    return { kind: "refund", state: "processing" };
  }
  if (stated === "succeeded" || !isStripeRefund(payment)) return { kind: "refund", state: "done" };
  return { kind: "refund", state: "issued" };
};

/**
 * A payment Stripe counts as refunded in full (status `refunded`): `done`, said refunded,
 * only when every refund of it is known made; else `issued`, never said refunded. Done
 * needs all of:
 * - no refund id stamped on the payment itself (the oldest webhooks' shape, whose refund
 *   has no row of its own to read);
 * - no Stripe refund row of the reservation without a link to a payment: the rows cannot
 *   tell whether such a refund came off this payment or another of the reservation, so
 *   Louez stays neutral;
 * - at least one refund linked to it, and each reading `done` by `readPaymentRow` (none
 *   issued, in progress or failed).
 */
export const refundedPaymentState = (
  payment: PaymentLike,
  payments: readonly PaymentLike[],
  refunds: readonly {
    refundPaymentId: string | null;
    status: "pending" | "succeeded" | "failed";
  }[],
): "done" | "issued" => {
  if (payment.stripeRefundId) return "issued";
  const unlinkedStripeRefund = payments.some(
    (candidate) => isStripeRefundRow(candidate) && !candidate.refundOfPaymentId,
  );
  if (unlinkedStripeRefund) return "issued";
  const statuses = refundStatusByRow(refunds);
  const linked = payments.filter(
    (candidate) => payment.id !== undefined && candidate.refundOfPaymentId === payment.id,
  );
  const allMade =
    linked.length > 0 &&
    linked.every((candidate) => {
      const read = readPaymentRow(candidate, statuses);
      return read.kind === "refund" && read.state === "done";
    });
  return allMade ? "done" : "issued";
};

/** With `currency`, the reservation's, a payment in another currency pays nothing. */
export const isRentalPaid = (payments: readonly PaymentLike[], currency?: string): boolean =>
  payments.some(
    (payment) =>
      payment.type === "rental" &&
      payment.status === "completed" &&
      !isRefundRow(payment) &&
      (!currency || isPaymentInCurrency(payment, currency)),
  );

/** A rental payment still `pending` (3DS, webhook lag). */
export const hasRentalPaymentInProgress = (payments: readonly PaymentLike[]): boolean =>
  payments.some((payment) => payment.type === "rental" && payment.status === "pending");

export const getReservationPaymentStatus = (
  payments: readonly PaymentLike[],
): ReservationPaymentStatus => {
  if (isRentalPaid(payments)) return "paid";
  if (hasRentalPaymentInProgress(payments)) return "processing";
  return "unpaid";
};

// What settles a rental, defined once beside the money it reads.
export { getRentalPaid };

/**
 * The deposit as the reservation's page reads it, by the shared refund rule
 * (`getSettledPaymentAmount`), as the cancellation preview reads it: `held`
 * is the completed deposits, less the completed returns linked to them and
 * the returns made apart, never below zero. A return linked to a deposit that
 * is not completed gives back nothing that was held. `collected` is the
 * completed deposits received. `returned` is the completed returns themselves,
 * not a difference: a Stripe refund has already brought its deposit down to
 * its net amount, so it is in `returned` and no longer in `collected` or `held`.
 */
export const getDepositTotals = (
  payments: readonly PaymentLike[],
): { collected: number; returned: number; held: number } => {
  const collected = payments
    .filter(
      (payment) =>
        payment.type === "deposit" && payment.status === "completed" && !isRefundRow(payment),
    )
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const held = Math.max(
    0,
    getSettledPaymentAmount(payments, "deposit") -
      getSettledPaymentAmount(payments, "deposit_return"),
  );
  const byId = new Map(payments.flatMap((payment) => (payment.id ? [[payment.id, payment]] : [])));
  const returned = payments
    .filter((payment) => {
      if (payment.type !== "deposit_return" || payment.status !== "completed") return false;
      if (isStripeRefundRow(payment) || !payment.refundOfPaymentId) return true;
      const original = byId.get(payment.refundOfPaymentId);
      return original?.type === "deposit" && original.status === "completed";
    })
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  return { collected, returned, held };
};

/** Damage fees charged on top of the rental, refunds subtracted. */
export const getDamageFees = (payments: readonly PaymentLike[]): number =>
  getSettledPaymentAmount(payments, "damage");

/**
 * The payment rows worth listing to the customer. Of the deposit holds, only the
 * one their card carries for the reservation, `depositPaymentIntentId`, with its
 * release: an authorization the store asked for and Stripe never confirmed, a
 * refused one and a second one on its way out are not theirs to read
 * (`isCustomerDepositHoldRow`). A hold that was captured is dropped, since the
 * capture row carries the amount actually taken and the hold row would show the
 * full deposit as "taken".
 */
export const getCustomerPaymentRows = <T extends PaymentLike>(
  payments: readonly T[],
  depositPaymentIntentId: string | null | undefined,
  refundStatuses?: RefundStatusByRow,
): T[] => {
  const captured = payments.some(
    (payment) => payment.type === "deposit_capture" && payment.status === "completed",
  );
  return payments.filter((payment) => {
    // A refund that gave nothing back is no money given back to the customer: its row
    // failed, or the operation that asked for it did (`readPaymentRow`).
    const read = readPaymentRow(payment, refundStatuses);
    if (read.kind === "refund" && read.state === "failed") return false;
    if (payment.type !== "deposit_hold") return true;
    if (!isCustomerDepositHoldRow(payment, depositPaymentIntentId)) return false;
    return !(captured && payment.status === "completed");
  });
};

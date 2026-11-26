import {
  type PaymentLike,
  type RefundState,
  isRefundRow,
  readPaymentRow,
  refundStatusByRow,
} from "@/lib/reservations/util.payment-status";

/** A person of the store, as the reservation names them. */
interface RefundPersonLike {
  name: string | null;
  email: string;
  image: string | null;
}

/** A refund asked through Louez, as the reservation states it (`reservation.refunds`). */
interface RefundOperationLike {
  id: string;
  refundPaymentId: string | null;
  status: "pending" | "succeeded" | "failed";
  requestedBy: RefundPersonLike | null;
  approvedBy: RefundPersonLike | null;
}

export interface RefundActivityContext {
  payments: readonly (PaymentLike & { stripeRefundId?: string | null; currency?: string | null })[];
  refunds: readonly RefundOperationLike[];
}

/**
 * What a history line about a refund says. `refund`: a refund of `amount`, in the state the
 * one reader gives it (`readPaymentRow`: made, issued at Stripe, in progress or failed), with
 * the person who refunded it from the dashboard, or who approved an agent's. `to_check`: a refund Louez holds failed that
 * Stripe later listed as made. `stripe_count`: what Stripe counted as refunded on the payment
 * when it told Louez, pending refunds included: a record of that moment, never a settlement.
 */
export type RefundActivityView =
  | {
      kind: "refund";
      state: RefundState;
      amount: number | null;
      currency: string | null;
      requestedBy: RefundOperationLike["requestedBy"];
      approvedBy: RefundOperationLike["approvedBy"];
    }
  | { kind: "to_check" }
  | { kind: "stripe_count"; amount: number | null; full: boolean };

const text = (value: unknown) => (typeof value === "string" ? value : null);
const number = (value: unknown) => {
  const amount = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
};

/** A refund whose row is not read: its operation's word, else what its writer knew. */
const operationState = (status: RefundOperationLike["status"]): RefundState =>
  status === "failed" ? "failed" : status === "pending" ? "processing" : "done";

/**
 * Reads a `payment_updated` line by the shape its writer gave it, as stored (no line is
 * rewritten):
 * - the refund operation's (`refundOperationId`, `paymentId` its refund row), since 2026-10;
 * - a refund Stripe failed (`kind: "refund_undone"`) and a failed refund later listed as made
 *   (`kind: "refund_failed_listed"`), from the same writer;
 * - the dashboard's Stripe refund before operations (`refundId`, `type` `rental_refund` or
 *   `deposit_return`, `paymentId` its refund row when one was written);
 * - a refund the store recorded by hand from the dashboard (`action: "refunded"`,
 *   `refundPaymentId` its row);
 * - the Connect webhook's `charge.refunded` (`chargeId`, `refundAmount`, `isFullRefund`).
 * A refund's state is its row's, by the reader the payment card uses. Null for any other
 * line (a payment deleted, a deposit hold's finding, a fee figure).
 */
export function refundActivityView(
  activity: { activityType: string; metadata: Record<string, unknown> | null },
  context: RefundActivityContext,
): RefundActivityView | null {
  const metadata = activity.metadata;
  if (activity.activityType !== "payment_updated" || !metadata) return null;

  if (metadata.kind === "refund_failed_listed") return { kind: "to_check" };

  const refund = (rowId: string | null, refundId: string | null, unread: RefundState) => {
    const operationId = text(metadata.refundOperationId);
    const operation = context.refunds.find((candidate) =>
      operationId ? candidate.id === operationId : candidate.refundPaymentId === rowId,
    );
    // Its row by the id the line names, else by the Stripe refund it names (a refund row,
    // never the charge the oldest webhooks stamped with it).
    const row =
      context.payments.find((payment) => rowId !== null && payment.id === rowId) ??
      context.payments.find(
        (payment) =>
          refundId !== null && payment.stripeRefundId === refundId && isRefundRow(payment),
      );
    const read = row ? readPaymentRow(row, refundStatusByRow(context.refunds)) : null;
    const state =
      metadata.kind === "refund_undone"
        ? "failed"
        : read?.kind === "refund"
          ? read.state
          : operation
            ? operationState(operation.status)
            : unread;
    return {
      kind: "refund" as const,
      state,
      amount: number(metadata.amount),
      currency: text(metadata.currency) ?? row?.currency ?? null,
      requestedBy: operation?.requestedBy ?? null,
      approvedBy: operation?.approvedBy ?? null,
    };
  };

  // Each Stripe line: Stripe made the refund; unless a row or an operation says more,
  // whether it settled is not known.
  if (text(metadata.refundOperationId) || metadata.kind === "refund_undone") {
    return refund(text(metadata.paymentId), text(metadata.refundId), "issued");
  }
  if (
    text(metadata.refundId) &&
    (metadata.type === "rental_refund" || metadata.type === "deposit_return")
  ) {
    return refund(text(metadata.paymentId), text(metadata.refundId), "issued");
  }
  // Given by hand: the store's own word.
  if (metadata.action === "refunded") {
    return refund(text(metadata.refundPaymentId), null, "done");
  }

  if (text(metadata.chargeId) && "refundAmount" in metadata) {
    const view = {
      kind: "stripe_count" as const,
      amount: number(metadata.refundAmount),
      full: metadata.isFullRefund === true,
    };
    return view.full || view.amount !== null ? view : null;
  }
  return null;
}

/** The line's title, a key of `dashboard.reservations`; `amount` goes in Stripe's count. */
export const refundActivityTitleKey = (view: RefundActivityView): string => {
  switch (view.kind) {
    case "to_check":
      return "activity.refundToCheck";
    case "stripe_count":
      return view.full ? "activity.stripeRefundCountFull" : "activity.stripeRefundCount";
    case "refund":
      switch (view.state) {
        case "done":
          return "activity.refundDone";
        case "issued":
          return "activity.refundIssued";
        case "processing":
          return "payment.refundProcessing";
        case "failed":
          return "activity.refundFailed";
      }
  }
};

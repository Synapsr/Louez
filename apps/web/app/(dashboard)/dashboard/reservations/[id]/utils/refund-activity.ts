import {
  type PaymentLike,
  readPaymentRow,
  refundStatusByRow,
} from "@/lib/reservations/util.payment-status";

/** A refund asked through Louez, as the reservation states it (`reservation.refunds`). */
interface RefundOperationLike {
  id: string;
  refundPaymentId: string | null;
  status: "pending" | "succeeded" | "failed";
  approvedBy: { name: string | null; email: string; image: string | null } | null;
}

export interface RefundActivityContext {
  payments: readonly PaymentLike[];
  refunds: readonly RefundOperationLike[];
}

/**
 * What a history line about a refund of an online payment says. `refund`: a refund of
 * `amount`, `done`, `processing` while Stripe has not settled it, or `failed`, with the
 * person who approved it when one did. `to_check`: a refund Louez holds failed that Stripe
 * later listed as made. `online_total`: what came off the charge in all, as Stripe told it.
 */
export type RefundActivityView =
  | {
      kind: "refund";
      state: "done" | "processing" | "failed";
      amount: number | null;
      currency: string | null;
      approvedBy: RefundOperationLike["approvedBy"];
    }
  | { kind: "to_check" }
  | { kind: "online_total"; amount: number | null; full: boolean };

const text = (value: unknown) => (typeof value === "string" ? value : null);
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** A refund whose row is not read: its operation's word, else made. */
const operationState = (status: RefundOperationLike["status"] | undefined) =>
  status === "failed" ? "failed" : status === "pending" ? "processing" : "done";

/**
 * Reads a `payment_updated` line by the shape its writer gave it, as stored: the refund
 * writer's (`refundOperationId`), the refund undone (`kind: "refund_undone"`) and the failed
 * refund listed as made (`kind: "refund_failed_listed"`, apps/web
 * lib/reservations/stripe-refund-writes.ts), and the Connect webhook's `charge.refunded`
 * (`chargeId`, `refundAmount`). A refund's state is its row's, by `readPaymentRow`, so the
 * line and the payment card say the same. Null for any other line.
 */
export function refundActivityView(
  activity: { activityType: string; metadata: Record<string, unknown> | null },
  context: RefundActivityContext,
): RefundActivityView | null {
  const metadata = activity.metadata;
  if (activity.activityType !== "payment_updated" || !metadata) return null;

  if (metadata.kind === "refund_failed_listed") return { kind: "to_check" };

  const operationId = text(metadata.refundOperationId);
  if (operationId || metadata.kind === "refund_undone") {
    const rowId = text(metadata.paymentId);
    const operation = context.refunds.find((refund) =>
      operationId ? refund.id === operationId : refund.refundPaymentId === rowId,
    );
    const row = context.payments.find((payment) => payment.id === rowId);
    const read = row ? readPaymentRow(row, refundStatusByRow(context.refunds)) : null;
    return {
      kind: "refund",
      state:
        metadata.kind === "refund_undone"
          ? "failed"
          : read?.kind === "refund"
            ? read.state
            : operationState(operation?.status),
      amount: number(metadata.amount),
      currency: text(metadata.currency),
      approvedBy: operation?.approvedBy ?? null,
    };
  }

  if (text(metadata.chargeId) && "refundAmount" in metadata) {
    return {
      kind: "online_total",
      amount: number(metadata.refundAmount),
      full: metadata.isFullRefund === true,
    };
  }
  return null;
}

/** The line's title, a key of `dashboard.reservations`. */
export const refundActivityTitleKey = (view: RefundActivityView): string => {
  if (view.kind === "to_check") return "activity.refundToCheck";
  if (view.kind === "online_total") {
    return view.full ? "activity.onlineRefundFull" : "activity.onlineRefundTotal";
  }
  if (view.state === "processing") return "payment.refundProcessing";
  return view.state === "failed" ? "activity.refundFailed" : "activity.refundDone";
};

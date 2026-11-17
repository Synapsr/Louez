import type { PaymentRowReading } from "@/lib/reservations/util.payment-status";

export type PaymentBadgeVariant = "success" | "pending" | "failed" | "tertiary" | "info";

const STATUS_VARIANT: Record<string, PaymentBadgeVariant> = {
  completed: "success",
  authorized: "info",
  pending: "pending",
  failed: "failed",
  refunded: "tertiary",
  cancelled: "tertiary",
};

/**
 * The state the customer reads on a payment row, a key of `storefront.account.paymentHistory`
 * and its tone, from the reader's result (`readPaymentRow`). A refund reads its own state to
 * the end, never its row's payment status; the switch has no default, so a state the reader
 * gains must be named here before it compiles.
 */
export function customerPaymentBadge(
  reading: PaymentRowReading,
  status: string,
  /** A payment refunded in full: `done` only when each of its refunds is known made (`refundedPaymentState`). */
  refunded: "done" | "issued" | null = null,
): { key: string; variant: PaymentBadgeVariant } {
  switch (reading.kind) {
    case "receipt":
      // Said refunded only when known made; else, or when not read, issued.
      if (status === "refunded" && refunded !== "done") {
        return { key: "refundedStatus.issued", variant: "info" };
      }
      return { key: `status.${status}`, variant: STATUS_VARIANT[status] ?? "tertiary" };
    case "hold":
      return { key: `holdStatus.${status}`, variant: STATUS_VARIANT[status] ?? "tertiary" };
    case "refund":
      switch (reading.state) {
        case "done":
          return { key: "refundStatus.done", variant: "tertiary" };
        case "issued":
          return { key: "refundStatus.issued", variant: "info" };
        case "processing":
          return { key: "refundStatus.processing", variant: "pending" };
        case "failed":
          return { key: "refundStatus.failed", variant: "failed" };
      }
  }
}

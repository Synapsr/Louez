import { and, asc, eq } from "drizzle-orm";

import { type Database, apiHandoffs, paymentRefundOperations, users } from "@louez/db";

import type { StripeRefundStatus } from "../contracts/stripe-refunds";

/**
 * A refund operation's status as Stripe's outcome reads it (`get_refund`'s `status`):
 * `pending` until Stripe gives the final word, whether Louez is still sending it or
 * the bank is processing it.
 */
export const onlineRefundStatus = (
  status: "requested" | "unresolved" | "pending" | "succeeded" | "failed",
): StripeRefundStatus =>
  status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : "pending";

/** A refund of an online payment the store asked for, as the reservation's page reads it. */
export interface ReservationOnlineRefund {
  id: string;
  paymentId: string;
  /** Its own payment row once Stripe made the refund; null before. */
  refundPaymentId: string | null;
  status: StripeRefundStatus;
  /** The person who approved it, when one did (an agent's refund). */
  approvedBy: { name: string | null; email: string; image: string | null } | null;
}

/**
 * The reservation's refunds of online payments (`payment_refund_operations`), oldest
 * first, with the person whose approval each carries. A reader only: what the rows say
 * of the money is the payment rows'.
 */
export async function listReservationOnlineRefunds(
  executor: Pick<Database, "select">,
  storeId: string,
  reservationId: string,
): Promise<ReservationOnlineRefund[]> {
  const o = paymentRefundOperations;
  const rows = await executor
    .select({
      id: o.id,
      paymentId: o.paymentId,
      refundPaymentId: o.refundPaymentId,
      status: o.status,
      approverName: users.name,
      approverEmail: users.email,
      approverImage: users.image,
    })
    .from(o)
    .leftJoin(
      apiHandoffs,
      and(eq(apiHandoffs.id, o.approvalId), eq(apiHandoffs.storeId, o.storeId)),
    )
    .leftJoin(users, eq(users.id, apiHandoffs.decidedByUserId))
    .where(and(eq(o.storeId, storeId), eq(o.reservationId, reservationId)))
    .orderBy(asc(o.createdAt), asc(o.id));
  return rows.map((row) => ({
    id: row.id,
    paymentId: row.paymentId,
    refundPaymentId: row.refundPaymentId,
    status: onlineRefundStatus(row.status),
    approvedBy:
      row.approverEmail === null
        ? null
        : { name: row.approverName, email: row.approverEmail, image: row.approverImage },
  }));
}

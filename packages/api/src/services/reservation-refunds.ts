import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

import {
  type Database,
  apiHandoffs,
  paymentDisputes,
  paymentRefundOperations,
  users,
} from "@louez/db";

import type { StripeRefundStatus } from "../contracts/stripe-refunds";
import { decimalOfMinor } from "./payment-amount";

/**
 * A refund operation's status as Stripe's outcome reads it (`get_refund`'s `status`):
 * `pending` until Stripe gives the final word, whether Louez is still sending it or
 * the bank is processing it.
 */
export const onlineRefundStatus = (
  status: "requested" | "unresolved" | "pending" | "succeeded" | "failed",
): StripeRefundStatus =>
  status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : "pending";

/** A person of the store, as the reservation's page names them. */
export interface RefundPerson {
  name: string | null;
  email: string;
  image: string | null;
}

/** A refund of an online payment the store asked for, as the reservation's page reads it. */
export interface ReservationOnlineRefund {
  id: string;
  paymentId: string;
  /** Its own payment row once Stripe made the refund; null before. */
  refundPaymentId: string | null;
  status: StripeRefundStatus;
  /** The amount given back, in the payment's currency, with its decimals. */
  amount: string;
  currency: string;
  /** When it was asked. */
  createdAt: Date;
  /** Why Stripe made no refund, or why the one it made failed; null unless failed. */
  failure: { code: string; message: string | null } | null;
  /** The person who refunded it from the dashboard; null when an agent asked (see `approvedBy`). */
  requestedBy: RefundPerson | null;
  /** The person who approved it, when one did (an agent's refund). */
  approvedBy: RefundPerson | null;
}

/** A dispute opened on one of the reservation's payments taken online. */
export interface ReservationPaymentDispute {
  paymentId: string;
  /** `open` while the customer's bank holds the money: no refund until it ends. */
  status: "open" | "won" | "lost";
}

const requesters = alias(users, "refund_requesters");

/**
 * The query of a reservation's refund operations, through its payments taken online: the
 * payment's predicate is what lets the table's index on the payment serve it (the store and
 * the reservation are conditions on what it finds). Built apart so a test can read its SQL.
 */
export const reservationOnlineRefundsQuery = (
  executor: Pick<Database, "select">,
  storeId: string,
  reservationId: string,
  onlinePaymentIds: readonly string[],
) => {
  const o = paymentRefundOperations;
  return (
    executor
      .select({
        id: o.id,
        paymentId: o.paymentId,
        refundPaymentId: o.refundPaymentId,
        status: o.status,
        amountMinor: o.amountMinor,
        currency: o.currency,
        createdAt: o.createdAt,
        failureCode: o.failureCode,
        failureMessage: o.failureMessage,
        requesterName: requesters.name,
        requesterEmail: requesters.email,
        requesterImage: requesters.image,
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
      // Asked without an approval: a person in the dashboard, who is the one to name.
      .leftJoin(requesters, and(eq(requesters.id, o.requestedByUserId), isNull(o.approvalId)))
      .where(
        and(
          inArray(o.paymentId, [...onlinePaymentIds]),
          eq(o.storeId, storeId),
          eq(o.reservationId, reservationId),
        ),
      )
      .orderBy(asc(o.createdAt), asc(o.id))
  );
};

/**
 * The reservation's refunds of online payments (`payment_refund_operations`), oldest
 * first, with the person whose approval each carries. An operation gives money back from
 * one of the reservation's own Stripe payments, so it is reached through them, by the
 * table's index on the payment, within the store: no other reservation's operation is read.
 * No query when the reservation has no payment taken online. A reader only: what the rows
 * say of the money is the payment rows'.
 */
export async function listReservationOnlineRefunds(
  executor: Pick<Database, "select">,
  storeId: string,
  reservationId: string,
  payments: readonly { id: string; method: string }[],
): Promise<ReservationOnlineRefund[]> {
  const onlinePaymentIds = payments.flatMap((payment) =>
    payment.method === "stripe" ? [payment.id] : [],
  );
  if (onlinePaymentIds.length === 0) return [];
  const rows = await reservationOnlineRefundsQuery(
    executor,
    storeId,
    reservationId,
    onlinePaymentIds,
  );
  return rows.map((row) => ({
    id: row.id,
    paymentId: row.paymentId,
    refundPaymentId: row.refundPaymentId,
    status: onlineRefundStatus(row.status),
    amount: decimalOfMinor(row.amountMinor, row.currency),
    currency: row.currency,
    createdAt: row.createdAt,
    failure:
      row.status === "failed"
        ? { code: row.failureCode ?? "failed", message: row.failureMessage }
        : null,
    requestedBy:
      row.requesterEmail === null
        ? null
        : { name: row.requesterName, email: row.requesterEmail, image: row.requesterImage },
    approvedBy:
      row.approverEmail === null
        ? null
        : { name: row.approverName, email: row.approverEmail, image: row.approverImage },
  }));
}

/**
 * The disputes opened on the reservation's payments taken online, oldest first: an open
 * one stops any refund of its payment (`PAYMENT_DISPUTED`). Reached through the
 * reservation's own payments, by the table's index on the payment; no query for a
 * reservation paid only by hand.
 */
export async function listReservationPaymentDisputes(
  executor: Pick<Database, "select">,
  reservationId: string,
  payments: readonly { id: string; method: string }[],
): Promise<ReservationPaymentDispute[]> {
  const onlinePaymentIds = payments.flatMap((payment) =>
    payment.method === "stripe" ? [payment.id] : [],
  );
  if (onlinePaymentIds.length === 0) return [];
  const d = paymentDisputes;
  return executor
    .select({ paymentId: d.paymentId, status: d.status })
    .from(d)
    .where(and(inArray(d.paymentId, onlinePaymentIds), eq(d.reservationId, reservationId)))
    .orderBy(asc(d.createdAt), asc(d.id));
}

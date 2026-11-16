import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import type { RefundCreditNoteOutcome } from "@louez/api";
import { db, payments, reservations } from "@louez/db";

import { issueRefundCreditNote, type RefundCreditNoteRequest } from "./refund-credit-note";

/** The payload as its writers write it; anything else is refused. */
const payloadSchema = z.object({
  storeId: z.string().min(1),
  reservationId: z.string().min(1),
  paymentId: z.string().min(1),
  refundId: z.string().min(1),
  amount: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/),
  source: z.string().min(1),
});

/** A refund row as the sender checks it: what it refunds, and whose it is. */
export interface RefundRow {
  refundOfPaymentId: string | null;
  reservationId: string;
  storeId: string;
  amount: string;
}

export interface RefundCreditNoteEffectDeps {
  readRefund: (refundId: string) => Promise<RefundRow | null>;
  issue: (request: RefundCreditNoteRequest) => Promise<RefundCreditNoteOutcome>;
}

async function readRefund(refundId: string): Promise<RefundRow | null> {
  const [row] = await db
    .select({
      refundOfPaymentId: payments.refundOfPaymentId,
      reservationId: payments.reservationId,
      storeId: reservations.storeId,
      amount: payments.amount,
    })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .where(and(eq(payments.id, refundId), eq(payments.status, "completed")));
  return row ?? null;
}

/**
 * The sender of `payment.refundCreditNote`: issues the credit note a refund is owed, one
 * given by hand (packages/api services/payment-records.ts, `recordPaymentRefund`) or a
 * Stripe refund (lib/reservations/stripe-refund-writes.ts, `recordChargeRefunds`).
 *
 * Before anything, it checks that the payload is the one the writer writes, that it
 * names the row's own store and reservation, and that its refund is a completed row of
 * that reservation refunding its payment, for its amount: a row that fails is given up
 * at once (`abandoned`, kept with its payload and reported), never retried. Then the credit note: issued
 * (now or before) is done; nothing to issue (the store issues no invoices, or the
 * payment has none) is done with nothing sent; a failure throws, so the outbox tries
 * again and gives up after its attempts.
 */
export function createRefundCreditNoteEffectSenders(
  overrides: Partial<RefundCreditNoteEffectDeps> = {},
): Pick<ApiEffectSenders, "payment.refundCreditNote"> {
  const deps: RefundCreditNoteEffectDeps = {
    readRefund,
    issue: issueRefundCreditNote,
    ...overrides,
  };
  return {
    "payment.refundCreditNote": async (payload, context) => {
      // A row written wrong: given up now, kept, and reported.
      const giveUp = (reason: string) => ({ abandoned: reason, report: true });
      const parsed = payloadSchema.safeParse(payload);
      if (!parsed.success) return giveUp("payload_invalid: not a refund's credit note");
      const request = parsed.data;
      const { row } = context;
      if (request.storeId !== row.storeId || request.reservationId !== row.reservationId) {
        return giveUp("row_mismatch: the payload names another store or reservation");
      }
      const refund = await deps.readRefund(request.refundId);
      if (
        !refund ||
        refund.refundOfPaymentId !== request.paymentId ||
        refund.reservationId !== request.reservationId ||
        refund.storeId !== request.storeId ||
        refund.amount !== request.amount
      ) {
        return giveUp("refund_mismatch: the refund is not this payment's, for this amount");
      }

      await context.assertClaim();
      const outcome = await deps.issue(request);
      if (outcome.status === "issued") return;
      if (outcome.status === "not_applicable") {
        return { skipped: `not_applicable: ${outcome.reason}` };
      }
      throw new Error(`The refund's credit note was not issued: ${outcome.reason}`);
    },
  };
}

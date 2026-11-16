import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import type { RefundCreditNoteOutcome } from "@louez/api";
import { db, payments, reservations } from "@louez/db";

import { reportServerError } from "@/lib/error-tracking";
import { log } from "@/lib/evlog";

import { issueRefundCreditNote, type RefundCreditNoteRequest } from "./refund-credit-note";

/** The payload as `recordPaymentRefund` writes it; anything else is refused. */
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
  /** Where a refused row is told: the logs and error tracking. */
  refuse: (event: { effectId: string; reason: string }) => void;
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

const refuse: RefundCreditNoteEffectDeps["refuse"] = (event) => {
  log.error({ invoicing: { event: "refund_credit_note_refused", ...event } });
  reportServerError(new Error(`A refund's credit note row was refused: ${event.reason}`), {
    source: "effects",
    effect: "payment.refundCreditNote",
  });
};

/**
 * The sender of `payment.refundCreditNote` (packages/api services/payment-records.ts,
 * `recordPaymentRefund`): issues the credit note a refund given by hand is owed.
 *
 * Before anything, it checks that the payload is the one the writer writes, that it
 * names the row's own store and reservation, and that its refund is a completed row of
 * that reservation refunding its payment, for its amount: a row that fails is given up
 * at once (cancelled, logged and reported), never retried. Then the credit note: issued
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
    refuse,
    ...overrides,
  };
  return {
    "payment.refundCreditNote": async (payload, context) => {
      const giveUp = (reason: string) => {
        deps.refuse({ effectId: context.effectId, reason });
        return { skipped: `refused: ${reason}` };
      };
      const parsed = payloadSchema.safeParse(payload);
      if (!parsed.success) return giveUp("the payload is not a refund's credit note");
      const request = parsed.data;
      const { envelope } = context;
      if (request.storeId !== envelope.storeId || request.reservationId !== envelope.reservationId) {
        return giveUp("the payload names another store or reservation than its row");
      }
      const refund = await deps.readRefund(request.refundId);
      if (
        !refund ||
        refund.refundOfPaymentId !== request.paymentId ||
        refund.reservationId !== request.reservationId ||
        refund.storeId !== request.storeId ||
        refund.amount !== request.amount
      ) {
        return giveUp("the refund is not this row's");
      }

      await context.assertClaim();
      const outcome = await deps.issue(request);
      if (outcome.status === "issued") return;
      if (outcome.status === "not_applicable") {
        return { skipped: `no credit note to issue: ${outcome.reason}` };
      }
      throw new Error(`The refund's credit note was not issued: ${outcome.reason}`);
    },
  };
}

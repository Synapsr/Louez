import { and, eq } from "drizzle-orm";

import type { RefundCreditNoteOutcome } from "@louez/api";
import { db, invoicePayments, invoices } from "@louez/db";

import { type InvoiceGenerationResult, tryGenerateCreditNoteForRefund } from "./service";

/** A refund given by hand whose credit note is asked for: the refund's row and the payment it gives back. */
export interface RefundCreditNoteRequest {
  paymentId: string;
  refundId: string;
  amount: string;
  /** Who asked, for the invoicing log. */
  source: string;
}

export interface RefundCreditNoteDeps {
  /** Issues the credit note, once per refund: a refund already credited answers `already_invoiced`. */
  generate: (
    context: { originalPaymentId: string; refundPaymentId: string },
    amount: string,
    source: string,
  ) => Promise<InvoiceGenerationResult>;
  /** The number of the credit note a refund already has, or null. */
  issuedNumber: (refundId: string) => Promise<string | null>;
}

async function issuedNumber(refundId: string): Promise<string | null> {
  const [row] = await db
    .select({ number: invoices.number })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
    .where(and(eq(invoicePayments.paymentId, refundId), eq(invoices.type, "credit_note")))
    .limit(1);
  return row?.number ?? null;
}

const LIVE: RefundCreditNoteDeps = { generate: tryGenerateCreditNoteForRefund, issuedNumber };

/**
 * The credit note of a refund the store gave by hand (`ApiPorts.paymentRefunds.creditNote`,
 * and the outbox's `payment.refundCreditNote`), issued once per refund
 * (`generateCreditNoteForRefund` locks both payment rows and finds a credit note
 * already linked to the refund). What it came to:
 *
 * - issued, now or by an earlier run, with its number;
 * - nothing to issue: the store issues no invoices (`invoicing_disabled`,
 *   `feature_disabled`), or the payment refunded has no invoice to credit
 *   (`payment_not_eligible`);
 * - a failure that may pass (`generation_failed`, a refund row not found yet): the
 *   outbox tries again.
 *
 * Never throws.
 */
export async function issueRefundCreditNote(
  request: RefundCreditNoteRequest,
  deps: RefundCreditNoteDeps = LIVE,
): Promise<RefundCreditNoteOutcome> {
  try {
    const result = await deps.generate(
      { originalPaymentId: request.paymentId, refundPaymentId: request.refundId },
      request.amount,
      request.source,
    );
    if (result.status === "generated") return { status: "issued", number: result.number };
    switch (result.reason) {
      case "already_invoiced": {
        const number = await deps.issuedNumber(request.refundId);
        return number
          ? { status: "issued", number }
          : { status: "failed", reason: "already_invoiced, but no credit note was found" };
      }
      case "invoicing_disabled":
      case "feature_disabled":
      case "payment_not_eligible":
      case "test_reservation":
        return { status: "not_applicable", reason: result.reason };
      case "payment_not_found":
      case "generation_failed":
        return { status: "failed", reason: result.reason };
    }
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

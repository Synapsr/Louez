import { and, desc, eq, sql } from "drizzle-orm";

import { dispatchEffects as runEffects, type ApiEffectSenders } from "@louez/api/platform/effects";
import type { StripeRefundsPort } from "@louez/api";
import { apiEffects, db, invoicePayments, invoices } from "@louez/db";

import {
  INLINE_REFUND_SEND_TIMEOUT_MS,
  type StripeRefundDeps,
  checkStripeRefund,
  getRefundOperation,
  readChargeForRefund,
  reconcileRefundOperation,
  requestStripeRefund,
} from "@/lib/reservations/stripe-refund";
import { stripeRefunds } from "@/lib/reservations/stripe-refund-stripe";

/**
 * The app's refund of a payment taken online, lent to the API's procedure
 * (packages/api services/stripe-refunds.ts): the charge read at Stripe, the checks and
 * the operation recorded in the procedure's transaction, the one attempt after its
 * commit through the outbox's sender, and the operation as its caller reads it.
 */
export function createStripeRefundsPort(
  deps: StripeRefundDeps & {
    /** The outbox's senders the inline attempt runs the operation's row with. */
    readonly senders: () => Promise<ApiEffectSenders>;
  } = {
    database: db,
    stripe: stripeRefunds,
    senders: async () => (await import("@/lib/api/effects")).apiEffectSenders,
  },
): StripeRefundsPort {
  return {
    readCharge: async (input) => {
      const read = await readChargeForRefund(deps, input);
      if (!read.ok) return { ok: false, refusal: { ...read, ok: undefined } };
      return { ok: true, charge: read.charge };
    },
    check: async (tx, request) => {
      const checked = await checkStripeRefund(tx, { ...request, requestedBy: noRequester });
      if (!checked.ok) return { ok: false, refusal: { ...checked, ok: undefined } };
      return { ok: true, checked };
    },
    request: async (tx, request) => {
      const requested = await requestStripeRefund(tx, request);
      if (!requested.ok) return { ok: false, refusal: { ...requested, ok: undefined } };
      return { ok: true, operationId: requested.operationId, effectIds: requested.effectIds };
    },
    attempt: async (effectIds) => {
      if (effectIds.length === 0) return;
      try {
        await runEffects(effectIds, await deps.senders(), {
          sendTimeoutMs: INLINE_REFUND_SEND_TIMEOUT_MS,
        });
      } catch {
        // The outbox has the row: its cron sends it.
      }
    },
    get: async ({ storeId, paymentId, operationId, reconcile }) => {
      const first = await getRefundOperation(deps.database, { storeId, operationId });
      if (!first || (paymentId !== null && first.paymentId !== paymentId)) return null;
      if (
        reconcile &&
        (first.status === "requested" ||
          first.status === "unresolved" ||
          first.status === "pending")
      ) {
        await reconcileRefundOperation(deps, operationId);
      }
      const operation =
        (await getRefundOperation(deps.database, { storeId, operationId })) ?? first;
      return {
        id: operation.id,
        status: operation.status,
        paymentId: operation.paymentId,
        reservationId: operation.reservationId,
        amountMinor: operation.amountMinor,
        currency: operation.currency,
        reason: operation.reason,
        createdAt: operation.createdAt,
        stripeRefundId: operation.stripeRefundId,
        // Kept when the refund failed after Stripe made it: its row is then `failed`.
        refundPaymentId: operation.refundPaymentId,
        failureCode: operation.failureCode,
        failureMessage: operation.failureMessage,
        creditNote: await creditNoteOf(deps, operation),
      };
    },
  };
}

const noRequester = { userId: null, credentialId: null };

/**
 * The credit note of the operation's refund row, as it exists: issued with its number
 * whatever became of the refund since (one that failed after leaves it standing, to
 * correct), still owed by its outbox row, or none. A refund that failed with no note
 * issued has none to issue.
 */
async function creditNoteOf(
  deps: Pick<StripeRefundDeps, "database">,
  operation: { status: string; refundPaymentId: string | null },
): Promise<{
  status: "issued" | "pending" | "not_applicable";
  number: string | null;
  needsCorrection: boolean;
}> {
  const failed = operation.status === "failed";
  const refundPaymentId = operation.refundPaymentId;
  if (!refundPaymentId) {
    return { status: failed ? "not_applicable" : "pending", number: null, needsCorrection: false };
  }
  const [note] = await deps.database
    .select({ number: invoices.number })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(and(eq(invoicePayments.paymentId, refundPaymentId), eq(invoices.type, "credit_note")))
    .limit(1);
  if (note) return { status: "issued", number: note.number, needsCorrection: failed };
  if (failed) return { status: "not_applicable", number: null, needsCorrection: false };
  const [owed] = await deps.database
    .select({ status: apiEffects.status })
    .from(apiEffects)
    .where(
      and(
        eq(apiEffects.type, "payment.refundCreditNote"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${apiEffects.payload}, '$.refundId')) = ${refundPaymentId}`,
      ),
    )
    .orderBy(desc(apiEffects.seq))
    .limit(1);
  // A row that ended with nothing to issue: the store issues no invoices, or the payment has none.
  if (owed?.status === "cancelled") {
    return { status: "not_applicable", number: null, needsCorrection: false };
  }
  return { status: "pending", number: null, needsCorrection: false };
}

export const stripeRefundsPort = createStripeRefundsPort();

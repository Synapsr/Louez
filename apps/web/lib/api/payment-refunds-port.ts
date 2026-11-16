import { nanoid } from "nanoid";

import type { PaymentRefundsPort } from "@louez/api";

import { issueRefundCreditNote } from "@/lib/invoicing/refund-credit-note";
import { insertManualRefund } from "@/lib/reservations/dashboard-payment-writes";

/**
 * The dashboard's writer of a refund the store gives by hand, lent to
 * `recordPaymentRefund` (packages/api services/payment-records.ts), which the
 * refund procedure and the dashboard's refund dialog both record through. The
 * row takes the currency the writer bound with its preview, the refunded
 * payment's (`insertManualRefund` keeps a currency it is handed). The credit
 * note is issued once per refund (`issueRefundCreditNote`), whether the
 * writer's attempt after the commit or the outbox row it owes it by asks.
 */
export function createPaymentRefundsPort(
  deps: { creditNote: PaymentRefundsPort["creditNote"] } = { creditNote: issueRefundCreditNote },
): PaymentRefundsPort {
  return {
    insert: async (tx, refund) => {
      const id = nanoid();
      await insertManualRefund(tx, {
        id,
        reservationId: refund.reservationId,
        storeId: refund.storeId,
        // Read only for a payment without a currency, which a refund never is here.
        storeSettings: null,
        reservationCurrency: null,
        original: { id: refund.paymentId, currency: refund.currency },
        type: refund.type,
        method: refund.method,
        amount: refund.amount,
        paidAt: refund.paidAt,
        notes: refund.notes,
      });
      return { id };
    },
    creditNote: deps.creditNote,
  };
}

export const paymentRefundsPort = createPaymentRefundsPort();

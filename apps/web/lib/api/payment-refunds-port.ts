import { nanoid } from "nanoid";

import type { PaymentRefundsPort } from "@louez/api";

import { tryGenerateCreditNoteForRefund } from "@/lib/invoicing/service";
import { insertManualRefund } from "@/lib/reservations/dashboard-payment-writes";

/**
 * The dashboard's writer of a refund the store gives by hand, lent to
 * `recordPaymentRefund` (packages/api services/payment-records.ts), which the
 * refund procedure and the dashboard's refund dialog both record through. The
 * row takes the currency the writer bound with its preview, the refunded
 * payment's (`insertManualRefund` keeps a currency it is handed). The credit
 * note comes once the refund is committed, and never fails it.
 */
export const paymentRefundsPort: PaymentRefundsPort = {
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
  creditNote: async (refund) => {
    const generation = await tryGenerateCreditNoteForRefund(
      { originalPaymentId: refund.paymentId, refundPaymentId: refund.refundId },
      refund.amount,
      refund.source,
    );
    return generation.status === "generated" ? generation.number : null;
  },
};

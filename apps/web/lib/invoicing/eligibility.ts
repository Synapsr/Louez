import { and, eq } from "drizzle-orm";

import {
  db,
  invoicePayments,
  invoices,
  payments,
  reservations,
  storeLegalProfiles,
} from "@louez/db";

import { isElectronicInvoicingEnabled } from "./feature";

type PaymentInvoiceGenerationEligibility =
  | { enabled: true }
  | { enabled: false; reason: "invoicing_disabled" | "feature_disabled" };

/** Whether the payment's store issues documents: its invoicing on, electronic invoicing open to it. */
export async function getPaymentInvoiceGenerationEligibility(
  paymentId: string,
): Promise<PaymentInvoiceGenerationEligibility> {
  const [profile] = await db
    .select({ storeId: reservations.storeId })
    .from(payments)
    .innerJoin(reservations, eq(payments.reservationId, reservations.id))
    .innerJoin(
      storeLegalProfiles,
      and(
        eq(storeLegalProfiles.storeId, reservations.storeId),
        eq(storeLegalProfiles.invoicingEnabled, true),
      ),
    )
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!profile) return { enabled: false, reason: "invoicing_disabled" };
  if (!(await isElectronicInvoicingEnabled(profile.storeId))) {
    return { enabled: false, reason: "feature_disabled" };
  }
  return { enabled: true };
}

/**
 * Whether a refund of this payment gets a credit note: the store issues documents and the
 * payment has the invoice the note credits (`tryGenerateCreditNoteForRefund`, service.ts).
 * What the dashboard tells a person before they refund it.
 */
export async function paymentRefundGetsCreditNote(paymentId: string): Promise<boolean> {
  const eligibility = await getPaymentInvoiceGenerationEligibility(paymentId);
  if (!eligibility.enabled) return false;
  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoicePayments)
    .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
    .where(and(eq(invoicePayments.paymentId, paymentId), eq(invoices.type, "invoice")))
    .limit(1);
  return Boolean(invoice);
}

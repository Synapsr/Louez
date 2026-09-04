import "server-only";

import { and, eq } from "drizzle-orm";

import { db, documents, invoices, payments } from "@louez/db";

import type { EmailAttachment } from "@/lib/email/client";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { sendPaymentConfirmationEmail } from "@/lib/email/send";
import { log } from "@/lib/evlog";
import { createReservationInstantAccessUrl } from "@/lib/reservations/instant-access";
import { getStorefrontUrl } from "@/lib/storefront-url";

const MAX_DOCUMENT_ATTACHMENTS_BYTES = 8 * 1024 * 1024;
const PDF_DATA_URL_PREFIX = "data:application/pdf;base64,";

export interface InitialInvoiceEmailDelivery {
  attachments: EmailAttachment[];
  contractSignatureUrl?: string;
}

function decodePdfAttachment(input: {
  fileName: string;
  fileUrl: string;
  cid: string;
}): EmailAttachment | null {
  if (!input.fileUrl.startsWith(PDF_DATA_URL_PREFIX)) return null;

  const content = Buffer.from(input.fileUrl.slice(PDF_DATA_URL_PREFIX.length), "base64");
  if (content.length < 5 || content.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return null;
  }

  return { filename: input.fileName, content, cid: input.cid };
}

export async function prepareInitialInvoiceEmailDelivery(
  reservationId: string,
): Promise<InitialInvoiceEmailDelivery> {
  const initialInvoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.reservationId, reservationId), eq(invoices.kind, "initial")),
    columns: { id: true },
    with: {
      document: {
        columns: { id: true, fileName: true, fileUrl: true },
      },
      reservation: {
        columns: { id: true, signedAt: true },
        with: {
          customer: { columns: { email: true } },
          store: { columns: { id: true, slug: true } },
        },
      },
    },
  });

  if (!initialInvoice) return { attachments: [] };

  const contract = await db.query.documents.findFirst({
    where: and(eq(documents.reservationId, reservationId), eq(documents.type, "contract")),
    columns: { id: true, fileName: true, fileUrl: true },
  });
  const candidates = [
    decodePdfAttachment({
      fileName: initialInvoice.document.fileName,
      fileUrl: initialInvoice.document.fileUrl,
      cid: `invoice-${initialInvoice.id}`,
    }),
    contract
      ? decodePdfAttachment({
          fileName: contract.fileName,
          fileUrl: contract.fileUrl,
          cid: `contract-${contract.id}`,
        })
      : null,
  ];

  const attachments: EmailAttachment[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (totalBytes + candidate.content.length > MAX_DOCUMENT_ATTACHMENTS_BYTES) {
      log.warn(
        "invoicing",
        `document attachment omitted because reservation ${reservationId} exceeds the 8 MB email limit`,
      );
      continue;
    }
    attachments.push(candidate);
    totalBytes += candidate.content.length;
  }

  const reservation = initialInvoice.reservation;
  const contractSignatureUrl = reservation.signedAt
    ? undefined
    : await createReservationInstantAccessUrl({
        storeId: reservation.store.id,
        storeSlug: reservation.store.slug,
        customerEmail: reservation.customer.email,
        reservationId,
      });

  return { attachments, contractSignatureUrl };
}

export async function tryPrepareInitialInvoiceEmailDelivery(
  reservationId: string,
): Promise<InitialInvoiceEmailDelivery> {
  try {
    return await prepareInitialInvoiceEmailDelivery(reservationId);
  } catch (error) {
    log.error(
      "invoicing",
      `invoice email delivery preparation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { attachments: [] };
  }
}

export async function trySendInitialInvoicePaymentConfirmation(paymentId: string): Promise<void> {
  try {
    const payment = await db.query.payments.findFirst({
      where: eq(payments.id, paymentId),
      columns: {
        amount: true,
        method: true,
        paidAt: true,
        createdAt: true,
      },
      with: {
        reservation: {
          columns: { id: true, number: true },
          with: {
            customer: {
              columns: { firstName: true, lastName: true, email: true },
            },
            store: {
              columns: {
                id: true,
                name: true,
                slug: true,
                email: true,
                logoUrl: true,
                darkLogoUrl: true,
                address: true,
                phone: true,
                theme: true,
                settings: true,
              },
            },
          },
        },
      },
    });
    if (!payment) return;

    const { reservation } = payment;
    const delivery = await tryPrepareInitialInvoiceEmailDelivery(reservation.id);
    await sendPaymentConfirmationEmail({
      to: reservation.customer.email,
      store: reservation.store,
      customer: reservation.customer,
      reservation,
      paymentAmount: Number(payment.amount),
      paymentDate: payment.paidAt ?? payment.createdAt,
      paymentMethod: payment.method,
      reservationUrl: getStorefrontUrl(
        reservation.store.slug,
        `/account/reservations/${reservation.id}`,
      ),
      locale: getLocaleFromCountry(reservation.store.settings?.country),
      documentAttachments: delivery.attachments,
      contractSignatureUrl: delivery.contractSignatureUrl,
    });
  } catch (error) {
    log.error(
      "invoicing",
      `payment confirmation delivery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

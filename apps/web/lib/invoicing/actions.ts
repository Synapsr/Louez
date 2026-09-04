"use server";

import {
  db,
  invoicePayments,
  invoices,
  payments,
  reservations,
  storeLegalProfiles,
} from "@louez/db";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";

import { log } from "@/lib/evlog";
import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

import { tryGenerateInvoiceForPayment } from "./service";
import { pollSuperPdpInvoiceEvents } from "./superpdp-events";
import { tryTransmitInvoiceNow } from "./superpdp-transmission";

const reservationIdSchema = z.string().length(21);
const invoiceIdSchema = z.string().length(21);

export type InvoiceReservationGenerationResult =
  | { status: "success"; generatedCount: number }
  | {
      status: "error";
      error: "unauthorized" | "invalid_reservation" | "invoicing_disabled";
    };

export async function generateInvoiceForReservation(
  reservationId: string,
): Promise<InvoiceReservationGenerationResult> {
  const parsed = reservationIdSchema.safeParse(reservationId);
  if (!parsed.success) return { status: "error", error: "invalid_reservation" };

  const store = await getCurrentStore();
  const canWrite = await currentUserHasPermission("write");
  if (!store || !canWrite) return { status: "error", error: "unauthorized" };

  const [reservation] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(
      storeLegalProfiles,
      and(
        eq(storeLegalProfiles.storeId, reservations.storeId),
        eq(storeLegalProfiles.invoicingEnabled, true),
      ),
    )
    .where(and(eq(reservations.id, parsed.data), eq(reservations.storeId, store.id)))
    .limit(1);
  if (!reservation) return { status: "error", error: "invoicing_disabled" };

  const linkedPaymentIds = db
    .select({ paymentId: invoicePayments.paymentId })
    .from(invoicePayments);
  const uninvoicedPayments = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.reservationId, reservation.id),
        eq(payments.status, "completed"),
        isNull(payments.stripeRefundId),
        inArray(payments.type, ["rental", "damage", "adjustment", "deposit_capture"]),
        notInArray(payments.id, linkedPaymentIds),
      ),
    )
    .orderBy(asc(payments.paidAt), asc(payments.createdAt));

  let generatedCount = 0;
  for (const payment of uninvoicedPayments) {
    const result = await tryGenerateInvoiceForPayment(
      payment.id,
      "dashboard_generate_invoice_for_reservation",
    );
    if (result.status === "generated") generatedCount += 1;
  }

  return { status: "success", generatedCount };
}

export type InvoiceTransmissionRecheckResult =
  | {
      status: "success";
      transmissionStatus:
        | "not_applicable"
        | "pending"
        | "sent"
        | "validated"
        | "rejected"
        | "failed";
    }
  | { status: "error"; error: "unauthorized" | "invalid_invoice" };

export async function recheckInvoiceTransmission(
  invoiceId: string,
): Promise<InvoiceTransmissionRecheckResult> {
  const parsed = invoiceIdSchema.safeParse(invoiceId);
  if (!parsed.success) return { status: "error", error: "invalid_invoice" };

  const store = await getCurrentStore();
  const canWrite = await currentUserHasPermission("write");
  if (!store || !canWrite) return { status: "error", error: "unauthorized" };

  const [invoice] = await db
    .select({ id: invoices.id, transmissionStatus: invoices.transmissionStatus })
    .from(invoices)
    .where(and(eq(invoices.id, parsed.data), eq(invoices.storeId, store.id)))
    .limit(1);
  if (!invoice) return { status: "error", error: "invalid_invoice" };

  if (invoice.transmissionStatus === "pending" || invoice.transmissionStatus === "failed") {
    await tryTransmitInvoiceNow(invoice.id);
  }
  // Pull the latest lifecycle statuses from Super PDP while we're at it; a
  // failure here must not mask a successful transmission attempt.
  try {
    await pollSuperPdpInvoiceEvents();
  } catch (error) {
    log.error(
      "superpdp",
      `event poll during recheck failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const [refreshed] = await db
    .select({ transmissionStatus: invoices.transmissionStatus })
    .from(invoices)
    .where(and(eq(invoices.id, invoice.id), eq(invoices.storeId, store.id)))
    .limit(1);

  return {
    status: "success",
    transmissionStatus: refreshed?.transmissionStatus ?? invoice.transmissionStatus,
  };
}

"use server";

import { db, invoicePayments, payments, reservations, storeLegalProfiles } from "@louez/db";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";

import { currentUserHasPermission, getCurrentStore } from "@/lib/store-context";

import { tryGenerateInvoiceForPayment } from "./service";

const reservationIdSchema = z.string().length(21);

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

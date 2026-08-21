import { renderToBuffer } from "@react-pdf/renderer";
import {
  db,
  documents,
  invoicePayments,
  invoices,
  payments,
  reservations,
  storeIntegrations,
  storeLegalProfiles,
} from "@louez/db";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { log } from "@/lib/evlog";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { InvoiceDocument } from "@/lib/pdf/invoice";
import { generateContract } from "@/lib/pdf/generate";
import { formatStoreDate } from "@/lib/utils/store-date";

import { buildCreditNoteSnapshots, buildInvoiceSnapshots } from "./core";
import { claimInvoiceNumber } from "./sequence";

const REVENUE_PAYMENT_TYPES = new Set(["rental", "damage", "adjustment", "deposit_capture"]);

export type InvoiceGenerationSkipReason =
  | "payment_not_found"
  | "payment_not_eligible"
  | "already_invoiced"
  | "invoicing_disabled"
  | "generation_failed";

export type InvoiceGenerationResult =
  | {
      status: "generated";
      invoiceId: string;
      documentId: string;
      number: string;
      reservationId: string;
      kind: "initial" | "complementary" | "credit_note";
    }
  | { status: "skipped"; reason: InvoiceGenerationSkipReason };

function skipped(reason: InvoiceGenerationSkipReason): InvoiceGenerationResult {
  return { status: "skipped", reason };
}

async function paymentHasEnabledLegalProfile(paymentId: string): Promise<boolean> {
  const [profile] = await db
    .select({ id: storeLegalProfiles.id })
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
  return Boolean(profile);
}

export async function generateInvoiceForPayment(
  paymentId: string,
): Promise<InvoiceGenerationResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${payments.id} FROM ${payments} WHERE ${payments.id} = ${paymentId} FOR UPDATE`,
    );

    const payment = await tx.query.payments.findFirst({
      where: eq(payments.id, paymentId),
      columns: {
        id: true,
        amount: true,
        type: true,
        method: true,
        status: true,
        stripeRefundId: true,
        currency: true,
        paidAt: true,
        createdAt: true,
      },
      with: {
        reservation: {
          columns: {
            id: true,
            storeId: true,
            customerId: true,
            deliveryFee: true,
            discountAmount: true,
            subtotalExclTax: true,
            taxAmount: true,
            tulipInsuranceAmount: true,
          },
          with: {
            store: {
              columns: { email: true, phone: true, settings: true, theme: true },
            },
            customer: {
              columns: {
                customerType: true,
                firstName: true,
                lastName: true,
                companyName: true,
                companyNumber: true,
                companyNumberScheme: true,
                vatNumber: true,
                address: true,
                city: true,
                postalCode: true,
                country: true,
                email: true,
                phone: true,
              },
            },
            items: {
              columns: {
                id: true,
                productId: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                taxRate: true,
                taxAmount: true,
                priceExclTax: true,
                totalExclTax: true,
                productSnapshot: true,
              },
            },
          },
        },
      },
    });

    if (!payment) return skipped("payment_not_found");
    if (
      payment.status !== "completed" ||
      payment.stripeRefundId !== null ||
      !REVENUE_PAYMENT_TYPES.has(payment.type) ||
      Number(payment.amount) <= 0
    ) {
      return skipped("payment_not_eligible");
    }

    const [existingLink] = await tx
      .select({ invoiceId: invoicePayments.invoiceId })
      .from(invoicePayments)
      .where(eq(invoicePayments.paymentId, payment.id))
      .limit(1);
    if (existingLink) return skipped("already_invoiced");

    const [legalProfile] = await tx
      .select({
        legalName: storeLegalProfiles.legalName,
        legalForm: storeLegalProfiles.legalForm,
        companyNumber: storeLegalProfiles.companyNumber,
        companyNumberScheme: storeLegalProfiles.companyNumberScheme,
        siret: storeLegalProfiles.siret,
        vatNumber: storeLegalProfiles.vatNumber,
        rcsCity: storeLegalProfiles.rcsCity,
        shareCapital: storeLegalProfiles.shareCapital,
        registeredAddress: storeLegalProfiles.registeredAddress,
        registeredAddressComplement: storeLegalProfiles.registeredAddressComplement,
        registeredPostalCode: storeLegalProfiles.registeredPostalCode,
        registeredCity: storeLegalProfiles.registeredCity,
        country: storeLegalProfiles.country,
        invoicingEnabled: storeLegalProfiles.invoicingEnabled,
      })
      .from(storeLegalProfiles)
      .where(eq(storeLegalProfiles.storeId, payment.reservation.storeId))
      .limit(1);
    if (!legalProfile?.invoicingEnabled) {
      log.info({
        invoicing: { event: "generation_skipped", paymentId, reason: "invoicing_disabled" },
      });
      return skipped("invoicing_disabled");
    }

    await tx.execute(
      sql`SELECT ${reservations.id} FROM ${reservations} WHERE ${reservations.id} = ${payment.reservation.id} FOR UPDATE`,
    );
    const [firstInvoice] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.reservationId, payment.reservation.id), eq(invoices.type, "invoice")))
      .limit(1);
    const issueAt = payment.paidAt ?? payment.createdAt;
    const issueDate = formatStoreDate(
      issueAt,
      payment.reservation.store.settings?.timezone,
      "yyyy-MM-dd",
      "en",
    );
    const number = await claimInvoiceNumber(
      tx,
      payment.reservation.storeId,
      "invoice",
      Number(issueDate.slice(0, 4)),
    );
    const currency = payment.currency ?? payment.reservation.store.settings?.currency ?? "EUR";
    const snapshots = buildInvoiceSnapshots(
      {
        reservation: payment.reservation,
        items: payment.reservation.items,
        store: payment.reservation.store,
        legalProfile,
        customer: payment.reservation.customer,
      },
      {
        number,
        issueDate,
        type: "invoice",
        currency,
        amountInclTax: payment.amount,
        // Post-return charges are their own supply — a dedicated line, not a
        // pro-rata slice of the rental lines.
        ...(payment.type === "damage" ||
        payment.type === "adjustment" ||
        payment.type === "deposit_capture"
          ? { chargeKind: payment.type }
          : {}),
      },
    );

    const [activeSuperPdp] = await tx
      .select({ id: storeIntegrations.id })
      .from(storeIntegrations)
      .where(
        and(
          eq(storeIntegrations.storeId, payment.reservation.storeId),
          eq(storeIntegrations.providerKey, "superpdp"),
          eq(storeIntegrations.enabled, true),
          eq(storeIntegrations.status, "active"),
        ),
      )
      .limit(1);
    const transmissionStatus =
      activeSuperPdp && ["FR", "BE"].includes(legalProfile.country) ? "pending" : "not_applicable";
    const locale = getLocaleFromCountry(legalProfile.country) === "fr" ? "fr" : "en";
    const pdfBuffer = await renderToBuffer(
      InvoiceDocument({
        type: "invoice",
        number,
        issueDate,
        currency,
        locale,
        primaryColor: payment.reservation.store.theme?.primaryColor,
        seller: snapshots.seller,
        buyer: snapshots.buyer,
        lines: snapshots.lines,
        vatBreakdown: snapshots.vatBreakdown,
        totals: snapshots.totals,
        processingRule: snapshots.processingRule,
        payment: { method: payment.method, paidAt: payment.paidAt, amount: payment.amount },
      }),
    );

    const documentId = nanoid();
    const invoiceId = nanoid();
    await tx.insert(documents).values({
      id: documentId,
      reservationId: payment.reservation.id,
      type: "invoice",
      number,
      fileName: `${locale === "fr" ? "facture" : "invoice"}-${number}.pdf`,
      fileUrl: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
    });
    const kind = firstInvoice ? "complementary" : "initial";
    await tx.insert(invoices).values({
      id: invoiceId,
      storeId: payment.reservation.storeId,
      reservationId: payment.reservation.id,
      customerId: payment.reservation.customerId,
      type: "invoice",
      kind,
      number,
      issueDate,
      currency,
      sellerSnapshot: snapshots.seller,
      buyerSnapshot: snapshots.buyer,
      lines: snapshots.lines,
      vatBreakdown: snapshots.vatBreakdown,
      totalExclTax: snapshots.totals.totalExclTax,
      totalTax: snapshots.totals.totalTax,
      totalInclTax: snapshots.totals.totalInclTax,
      en16931Snapshot: snapshots.en16931,
      documentId,
      processingRule: snapshots.processingRule,
      transmissionStatus,
      nextAttemptAt: transmissionStatus === "pending" ? new Date() : null,
    });
    await tx.insert(invoicePayments).values({
      id: nanoid(),
      invoiceId,
      paymentId: payment.id,
    });

    return {
      status: "generated",
      invoiceId,
      documentId,
      number,
      reservationId: payment.reservation.id,
      kind,
    };
  });
}

async function tryGenerateInitialContract(reservationId: string, source: string): Promise<void> {
  try {
    await generateContract({ reservationId });
  } catch (error) {
    log.error(
      "invoicing",
      `contract generation failed (${source}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function tryGenerateInvoiceForPayment(
  paymentId: string,
  source: string,
): Promise<InvoiceGenerationResult> {
  try {
    if (!(await paymentHasEnabledLegalProfile(paymentId))) {
      log.info({
        invoicing: { event: "trigger_skipped", paymentId, source, reason: "invoicing_disabled" },
      });
      return skipped("invoicing_disabled");
    }
    const result = await generateInvoiceForPayment(paymentId);
    if (result.status !== "generated") return result;

    // fr:212 e-reporting is posted by the transmission queue once Super PDP
    // has assigned the invoice an id — posting here would always no-op.

    if (result.kind === "initial") {
      await tryGenerateInitialContract(result.reservationId, source);
    }

    return result;
  } catch (error) {
    log.error(
      "invoicing",
      `invoice generation failed (${source}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return skipped("generation_failed");
  }
}

export interface RefundInvoiceContext {
  originalPaymentId: string;
  refundPaymentId: string;
}

export async function ensureRefundPaymentRecord(input: {
  originalPaymentId: string;
  stripeRefundId: string;
  amount: string | number;
  currency: string;
  type: "rental" | "deposit_return";
  paidAt: Date;
  notes?: string | null;
}): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT ${payments.id} FROM ${payments} WHERE ${payments.id} = ${input.originalPaymentId} FOR UPDATE`,
    );
    const originalPayment = await tx.query.payments.findFirst({
      where: eq(payments.id, input.originalPaymentId),
      columns: { reservationId: true },
    });
    if (!originalPayment) throw new Error("Original refund payment not found");

    const existingRefund = await tx.query.payments.findFirst({
      where: and(
        eq(payments.reservationId, originalPayment.reservationId),
        eq(payments.stripeRefundId, input.stripeRefundId),
      ),
      columns: { id: true },
    });
    if (existingRefund) return existingRefund.id;

    const refundPaymentId = nanoid();
    await tx.insert(payments).values({
      id: refundPaymentId,
      reservationId: originalPayment.reservationId,
      amount: Number(input.amount).toFixed(2),
      type: input.type,
      method: "stripe",
      status: "completed",
      stripeRefundId: input.stripeRefundId,
      currency: input.currency,
      notes: input.notes ?? null,
      paidAt: input.paidAt,
      createdAt: input.paidAt,
      updatedAt: input.paidAt,
    });
    return refundPaymentId;
  });
}

export async function tryEnsureRefundPaymentRecord(
  input: Parameters<typeof ensureRefundPaymentRecord>[0],
  source: string,
): Promise<string | null> {
  try {
    return await ensureRefundPaymentRecord(input);
  } catch (error) {
    log.error(
      "invoicing",
      `refund payment normalization failed (${source}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function generateCreditNoteForRefund(
  context: RefundInvoiceContext,
  refundAmount: string | number,
): Promise<InvoiceGenerationResult> {
  return db.transaction(async (tx) => {
    const lockedPaymentIds = [context.originalPaymentId, context.refundPaymentId].sort();
    for (const paymentId of lockedPaymentIds) {
      await tx.execute(
        sql`SELECT ${payments.id} FROM ${payments} WHERE ${payments.id} = ${paymentId} FOR UPDATE`,
      );
    }

    const refundPayment = await tx.query.payments.findFirst({
      where: eq(payments.id, context.refundPaymentId),
      columns: {
        id: true,
        amount: true,
        type: true,
        method: true,
        status: true,
        stripeRefundId: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        reservationId: true,
      },
      with: {
        reservation: {
          columns: {
            id: true,
            storeId: true,
            customerId: true,
            deliveryFee: true,
            discountAmount: true,
            subtotalExclTax: true,
            taxAmount: true,
            tulipInsuranceAmount: true,
          },
          with: {
            store: {
              columns: { email: true, phone: true, settings: true, theme: true },
            },
            customer: {
              columns: {
                customerType: true,
                firstName: true,
                lastName: true,
                companyName: true,
                companyNumber: true,
                companyNumberScheme: true,
                vatNumber: true,
                address: true,
                city: true,
                postalCode: true,
                country: true,
                email: true,
                phone: true,
              },
            },
            items: {
              columns: {
                id: true,
                productId: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                taxRate: true,
                taxAmount: true,
                priceExclTax: true,
                totalExclTax: true,
                productSnapshot: true,
              },
            },
          },
        },
      },
    });
    const originalPayment = await tx.query.payments.findFirst({
      where: eq(payments.id, context.originalPaymentId),
      columns: { id: true, type: true, stripeRefundId: true, reservationId: true },
    });

    if (!refundPayment || !originalPayment) return skipped("payment_not_found");
    if (
      !REVENUE_PAYMENT_TYPES.has(originalPayment.type) ||
      originalPayment.stripeRefundId !== null ||
      originalPayment.reservationId !== refundPayment.reservationId ||
      !["rental", "deposit_return"].includes(refundPayment.type) ||
      refundPayment.status !== "completed" ||
      !refundPayment.stripeRefundId ||
      Number(refundAmount) <= 0
    ) {
      return skipped("payment_not_eligible");
    }

    const [existingLink] = await tx
      .select({ invoiceId: invoicePayments.invoiceId })
      .from(invoicePayments)
      .where(eq(invoicePayments.paymentId, refundPayment.id))
      .limit(1);
    if (existingLink) return skipped("already_invoiced");

    const [originalInvoice] = await tx
      .select({
        id: invoices.id,
        number: invoices.number,
        issueDate: invoices.issueDate,
        seller: invoices.sellerSnapshot,
        buyer: invoices.buyerSnapshot,
        lines: invoices.lines,
        vatBreakdown: invoices.vatBreakdown,
        processingRule: invoices.processingRule,
        totalInclTax: invoices.totalInclTax,
      })
      .from(invoicePayments)
      .innerJoin(invoices, eq(invoicePayments.invoiceId, invoices.id))
      .where(and(eq(invoicePayments.paymentId, originalPayment.id), eq(invoices.type, "invoice")))
      .limit(1);
    if (!originalInvoice || Number(refundAmount) > Number(originalInvoice.totalInclTax)) {
      return skipped("payment_not_eligible");
    }

    const [legalProfile] = await tx
      .select({
        legalName: storeLegalProfiles.legalName,
        legalForm: storeLegalProfiles.legalForm,
        companyNumber: storeLegalProfiles.companyNumber,
        companyNumberScheme: storeLegalProfiles.companyNumberScheme,
        siret: storeLegalProfiles.siret,
        vatNumber: storeLegalProfiles.vatNumber,
        rcsCity: storeLegalProfiles.rcsCity,
        shareCapital: storeLegalProfiles.shareCapital,
        registeredAddress: storeLegalProfiles.registeredAddress,
        registeredAddressComplement: storeLegalProfiles.registeredAddressComplement,
        registeredPostalCode: storeLegalProfiles.registeredPostalCode,
        registeredCity: storeLegalProfiles.registeredCity,
        country: storeLegalProfiles.country,
        invoicingEnabled: storeLegalProfiles.invoicingEnabled,
      })
      .from(storeLegalProfiles)
      .where(eq(storeLegalProfiles.storeId, refundPayment.reservation.storeId))
      .limit(1);
    if (!legalProfile?.invoicingEnabled) {
      log.info({
        invoicing: {
          event: "credit_note_skipped",
          refundPaymentId: refundPayment.id,
          reason: "invoicing_disabled",
        },
      });
      return skipped("invoicing_disabled");
    }

    const issueAt = refundPayment.paidAt ?? refundPayment.createdAt;
    const issueDate = formatStoreDate(
      issueAt,
      refundPayment.reservation.store.settings?.timezone,
      "yyyy-MM-dd",
      "en",
    );
    const number = await claimInvoiceNumber(
      tx,
      refundPayment.reservation.storeId,
      "credit_note",
      Number(issueDate.slice(0, 4)),
    );
    const currency =
      refundPayment.currency ?? refundPayment.reservation.store.settings?.currency ?? "EUR";
    const precedingInvoice = {
      number: originalInvoice.number,
      issueDate: originalInvoice.issueDate,
    };
    const snapshots = buildCreditNoteSnapshots(
      {
        seller: originalInvoice.seller,
        buyer: originalInvoice.buyer,
        lines: originalInvoice.lines,
        vatBreakdown: originalInvoice.vatBreakdown,
        processingRule: originalInvoice.processingRule,
      },
      {
        reservation: refundPayment.reservation,
        items: refundPayment.reservation.items,
        store: refundPayment.reservation.store,
        legalProfile,
        customer: refundPayment.reservation.customer,
      },
      {
        number,
        issueDate,
        type: "credit_note",
        currency,
        amountInclTax: Number(refundAmount).toFixed(2),
        precedingInvoice,
      },
    );

    const [activeSuperPdp] = await tx
      .select({ id: storeIntegrations.id })
      .from(storeIntegrations)
      .where(
        and(
          eq(storeIntegrations.storeId, refundPayment.reservation.storeId),
          eq(storeIntegrations.providerKey, "superpdp"),
          eq(storeIntegrations.enabled, true),
          eq(storeIntegrations.status, "active"),
        ),
      )
      .limit(1);
    const transmissionStatus =
      activeSuperPdp && ["FR", "BE"].includes(legalProfile.country) ? "pending" : "not_applicable";
    const locale = getLocaleFromCountry(legalProfile.country) === "fr" ? "fr" : "en";
    const pdfBuffer = await renderToBuffer(
      InvoiceDocument({
        type: "credit_note",
        number,
        issueDate,
        currency,
        locale,
        primaryColor: refundPayment.reservation.store.theme?.primaryColor,
        seller: snapshots.seller,
        buyer: snapshots.buyer,
        lines: snapshots.lines,
        vatBreakdown: snapshots.vatBreakdown,
        totals: snapshots.totals,
        processingRule: snapshots.processingRule,
        payment: {
          method: refundPayment.method,
          paidAt: refundPayment.paidAt,
          amount: Number(refundAmount).toFixed(2),
        },
        precedingInvoice,
      }),
    );

    const documentId = nanoid();
    const invoiceId = nanoid();
    await tx.insert(documents).values({
      id: documentId,
      reservationId: refundPayment.reservation.id,
      type: "invoice",
      number,
      fileName: `${locale === "fr" ? "avoir" : "credit-note"}-${number}.pdf`,
      fileUrl: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
    });
    await tx.insert(invoices).values({
      id: invoiceId,
      storeId: refundPayment.reservation.storeId,
      reservationId: refundPayment.reservation.id,
      customerId: refundPayment.reservation.customerId,
      type: "credit_note",
      kind: "credit_note",
      number,
      issueDate,
      currency,
      sellerSnapshot: snapshots.seller,
      buyerSnapshot: snapshots.buyer,
      lines: snapshots.lines,
      vatBreakdown: snapshots.vatBreakdown,
      totalExclTax: snapshots.totals.totalExclTax,
      totalTax: snapshots.totals.totalTax,
      totalInclTax: snapshots.totals.totalInclTax,
      en16931Snapshot: snapshots.en16931,
      documentId,
      precedingInvoiceId: originalInvoice.id,
      processingRule: snapshots.processingRule,
      transmissionStatus,
      nextAttemptAt: transmissionStatus === "pending" ? new Date() : null,
    });
    await tx.insert(invoicePayments).values({
      id: nanoid(),
      invoiceId,
      paymentId: refundPayment.id,
    });

    return {
      status: "generated",
      invoiceId,
      documentId,
      number,
      reservationId: refundPayment.reservation.id,
      kind: "credit_note",
    };
  });
}

export async function tryGenerateCreditNoteForRefund(
  context: RefundInvoiceContext,
  refundAmount: string | number,
  source: string,
): Promise<InvoiceGenerationResult> {
  try {
    if (!(await paymentHasEnabledLegalProfile(context.refundPaymentId))) {
      log.info({
        invoicing: {
          event: "credit_note_trigger_skipped",
          refundPaymentId: context.refundPaymentId,
          source,
          reason: "invoicing_disabled",
        },
      });
      return skipped("invoicing_disabled");
    }
    return await generateCreditNoteForRefund(context, refundAmount);
  } catch (error) {
    log.error(
      "invoicing",
      `credit note generation failed (${source}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return skipped("generation_failed");
  }
}

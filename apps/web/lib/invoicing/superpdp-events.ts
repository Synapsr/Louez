import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  db,
  invoices,
  receivedInvoices,
  storeIntegrations,
  storeLegalProfiles,
  storeSuperPdpIntegrations,
} from "@louez/db";

import { log } from "@/lib/evlog";
import {
  markSuperPdpIntegrationFailure,
  markSuperPdpIntegrationHealthy,
} from "@/lib/integrations/providers/superpdp/connection";
import { withSuperPdpAccessToken } from "@/lib/integrations/providers/superpdp/credentials";
import {
  SUPERPDP_PROVIDER_KEY,
  createSuperPdpInvoiceEvent,
  getSuperPdpInvoice,
  listSuperPdpInvoiceEvents,
  type SuperPdpInvoice,
  type SuperPdpInvoiceEvent,
} from "@/lib/integrations/providers/superpdp/superpdp-client";
import { dispatchSupplierInvoiceReceived } from "@/lib/notifications/dispatcher";

const paymentAmountSchema = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/);

type IncomingInvoiceRecord = {
  superPdpInvoiceId: string;
  sellerName: string;
  sellerIdentifier: string;
  number: string;
  issueDate: string;
  totalExclTax: string;
  totalTax: string;
  totalInclTax: string;
  currency: string;
};

// Amounts in the en_invoice model are decimal strings, except
// total_vat_amount which is an { value, currency_code } object.
function readTotal(totals: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = totals[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (
      value !== null &&
      typeof value === "object" &&
      "value" in value &&
      typeof (value as { value: unknown }).value === "string"
    ) {
      return (value as { value: string }).value;
    }
  }
  return null;
}

/**
 * Lenient by design: an incoming document we cannot fully parse must still
 * land in the inbox (the downloadable PDF is the legal source of truth), and
 * must never mark the whole PDP connection as failed.
 */
function toIncomingInvoiceRecord(invoice: SuperPdpInvoice): IncomingInvoiceRecord {
  const enInvoice = invoice.en_invoice;
  const totals: Record<string, unknown> =
    (enInvoice?.invoice_totals as Record<string, unknown> | undefined) ??
    (enInvoice?.totals as Record<string, unknown> | undefined) ??
    {};
  const sellerIdentifier =
    enInvoice?.seller?.legal_registration_identifier?.value ??
    enInvoice?.seller?.identifiers?.[0]?.value ??
    "";
  const providerCreatedAt =
    "created_at" in invoice && typeof invoice.created_at === "string"
      ? invoice.created_at
      : new Date().toISOString();
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(enInvoice?.issue_date ?? "")
    ? (enInvoice?.issue_date as string)
    : providerCreatedAt.slice(0, 10);

  const record: IncomingInvoiceRecord = {
    superPdpInvoiceId: invoice.id,
    sellerName: enInvoice?.seller?.name ?? "—",
    sellerIdentifier,
    number: enInvoice?.number ?? `SPDP-${invoice.id}`,
    issueDate,
    totalExclTax:
      readTotal(totals, ["total_without_vat", "sum_invoice_lines_amount"]) ?? "0.00",
    totalTax: readTotal(totals, ["total_vat_amount"]) ?? "0.00",
    totalInclTax:
      readTotal(totals, ["total_with_vat", "amount_due_for_payment"]) ?? "0.00",
    currency: enInvoice?.currency_code ?? "EUR",
  };

  if (!enInvoice || record.totalInclTax === "0.00") {
    log.info({
      superpdp: { event: "incoming_invoice_partial_metadata", invoiceId: invoice.id },
    });
  }

  return record;
}

function transmissionStatusForEvent(statusCode: string): "validated" | "rejected" | null {
  if (statusCode === "api:validated") return "validated";
  if (statusCode === "api:rejected" || statusCode === "fr:213") {
    return "rejected";
  }
  return null;
}

async function processEventPage(input: {
  integrationId: string;
  storeId: string;
  events: SuperPdpInvoiceEvent[];
}): Promise<string | null> {
  if (input.events.length === 0) return null;

  const providerInvoiceIds = [...new Set(input.events.map((event) => event.invoice_id))];
  const localInvoices = await db
    .select({
      id: invoices.id,
      superPdpInvoiceId: invoices.superPdpInvoiceId,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.storeId, input.storeId),
        inArray(invoices.superPdpInvoiceId, providerInvoiceIds),
      ),
    );
  const localByProviderId = new Map<string, string>();
  for (const invoice of localInvoices) {
    if (invoice.superPdpInvoiceId) {
      localByProviderId.set(invoice.superPdpInvoiceId, invoice.id);
    }
  }
  const incomingByProviderId = new Map<string, IncomingInvoiceRecord>();

  for (const providerInvoiceId of providerInvoiceIds) {
    if (localByProviderId.has(providerInvoiceId)) continue;
    const providerInvoice = await withSuperPdpAccessToken(input.integrationId, (accessToken) =>
      getSuperPdpInvoice({ accessToken, invoiceId: providerInvoiceId }),
    );
    if (providerInvoice.direction === "in") {
      incomingByProviderId.set(providerInvoiceId, toIncomingInvoiceRecord(providerInvoice));
    }
  }

  const lastEventId = input.events.at(-1)?.id ?? null;
  const newIncomingInvoices: IncomingInvoiceRecord[] = [];
  await db.transaction(async (tx) => {
    for (const event of input.events) {
      const localInvoiceId = localByProviderId.get(event.invoice_id);
      if (localInvoiceId) {
        const transmissionStatus = transmissionStatusForEvent(event.status_code);
        await tx
          .update(invoices)
          .set({
            latestSuperPdpStatus: event.status_code,
            ...(transmissionStatus ? { transmissionStatus } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(invoices.id, localInvoiceId), eq(invoices.storeId, input.storeId)));
        continue;
      }

      const incoming = incomingByProviderId.get(event.invoice_id);
      if (!incoming) continue;
      const insertResult = await tx
        .insert(receivedInvoices)
        .values({
          id: nanoid(),
          storeId: input.storeId,
          ...incoming,
          latestStatus: event.status_code,
          documentId: null,
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            sellerName: incoming.sellerName,
            sellerIdentifier: incoming.sellerIdentifier,
            number: incoming.number,
            issueDate: incoming.issueDate,
            totalExclTax: incoming.totalExclTax,
            totalTax: incoming.totalTax,
            totalInclTax: incoming.totalInclTax,
            currency: incoming.currency,
            latestStatus: event.status_code,
            updatedAt: new Date(),
          },
        });
      if ((insertResult[0]?.affectedRows ?? 0) === 1) {
        newIncomingInvoices.push(incoming);
      }
    }

    if (lastEventId) {
      await tx
        .update(storeSuperPdpIntegrations)
        .set({ lastEventCursor: lastEventId, updatedAt: new Date() })
        .where(eq(storeSuperPdpIntegrations.integrationId, input.integrationId));
    }
  });

  for (const invoice of newIncomingInvoices) {
    void dispatchSupplierInvoiceReceived({ storeId: input.storeId, invoice }).catch((error) => {
      log.error(
        "invoicing",
        `supplier invoice notification failed for store ${input.storeId} and invoice ${invoice.superPdpInvoiceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  return lastEventId;
}

export async function pollSuperPdpInvoiceEvents(): Promise<{
  integrations: number;
  events: number;
  failed: number;
}> {
  const connectedIntegrations = await db
    .select({
      integrationId: storeIntegrations.id,
      storeId: storeIntegrations.storeId,
      lastEventCursor: storeSuperPdpIntegrations.lastEventCursor,
    })
    .from(storeIntegrations)
    .innerJoin(
      storeSuperPdpIntegrations,
      eq(storeSuperPdpIntegrations.integrationId, storeIntegrations.id),
    )
    .where(
      and(
        eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
        eq(storeIntegrations.enabled, true),
        inArray(storeIntegrations.status, ["active", "error"]),
      ),
    );

  let events = 0;
  let failed = 0;

  for (const integration of connectedIntegrations) {
    try {
      let cursor = integration.lastEventCursor;
      let hasAfter = true;
      let pageCount = 0;

      while (hasAfter) {
        if (pageCount++ >= 100) {
          throw new Error("Super PDP event pagination exceeded 100 pages");
        }
        const page = await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
          listSuperPdpInvoiceEvents({
            accessToken,
            startingAfterId: cursor,
            limit: 1000,
          }),
        );
        if (page.has_after && page.data.length === 0) {
          throw new Error("Super PDP returned an empty event page with has_after");
        }

        const nextCursor = await processEventPage({
          integrationId: integration.integrationId,
          storeId: integration.storeId,
          events: page.data,
        });
        events += page.data.length;
        if (nextCursor) cursor = nextCursor;
        hasAfter = page.has_after;
      }

      await markSuperPdpIntegrationHealthy(integration.integrationId);
    } catch (error) {
      failed++;
      await markSuperPdpIntegrationFailure(integration.integrationId, error);
      const message = error instanceof Error ? error.message : "Unknown error";
      log.error(
        "superpdp",
        `Invoice event polling failed for integration ${integration.integrationId}: ${message}`,
      );
    }
  }

  return {
    integrations: connectedIntegrations.length,
    events,
    failed,
  };
}

export async function postInvoicePaymentStatus(invoiceId: string, amount?: string): Promise<void> {
  const parsedAmount = amount ? paymentAmountSchema.parse(amount) : null;
  const [invoice] = await db
    .select({
      id: invoices.id,
      storeId: invoices.storeId,
      currency: invoices.currency,
      issueDate: invoices.issueDate,
      totalInclTax: invoices.totalInclTax,
      vatBreakdown: invoices.vatBreakdown,
      superPdpInvoiceId: invoices.superPdpInvoiceId,
      hasVatOnDebits: storeLegalProfiles.hasVatOnDebits,
      integrationId: storeIntegrations.id,
    })
    .from(invoices)
    .innerJoin(storeLegalProfiles, eq(storeLegalProfiles.storeId, invoices.storeId))
    .innerJoin(
      storeIntegrations,
      and(
        eq(storeIntegrations.storeId, invoices.storeId),
        eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
        eq(storeIntegrations.enabled, true),
        inArray(storeIntegrations.status, ["active", "error"]),
      ),
    )
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!invoice?.superPdpInvoiceId || invoice.hasVatOnDebits) return;
  const providerInvoiceId = invoice.superPdpInvoiceId;
  const reportedAmount = parsedAmount ?? invoice.totalInclTax;
  const singleVatRate = invoice.vatBreakdown.length === 1 ? invoice.vatBreakdown[0]?.taxRate : null;

  await withSuperPdpAccessToken(invoice.integrationId, (accessToken) =>
    createSuperPdpInvoiceEvent({
      accessToken,
      invoiceId: providerInvoiceId,
      statusCode: "fr:212",
      // BR-FR-CDV-14: the Encaissé status carries MDG-43 blocks typed MEN
      // with the collected amount and the payment date (our invoices are
      // issued at cash-in, so the issue date IS the payment date).
      details: [
        {
          reported_data: [
            {
              type_code: "MEN",
              amount: reportedAmount,
              currency_code: invoice.currency,
              date: invoice.issueDate,
              ...(singleVatRate ? { value_percent: singleVatRate } : {}),
            },
          ],
        },
      ],
    }),
  );
  await db
    .update(invoices)
    .set({ latestSuperPdpStatus: "fr:212", updatedAt: new Date() })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.storeId, invoice.storeId)));
}

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

function getRequiredTotal(
  totals: NonNullable<NonNullable<SuperPdpInvoice["en_invoice"]>["invoice_totals"]>,
  keys: Array<keyof typeof totals>,
  label: string,
): string {
  for (const key of keys) {
    const value = totals[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new Error(`Incoming Super PDP invoice is missing ${label}`);
}

function toIncomingInvoiceRecord(invoice: SuperPdpInvoice): IncomingInvoiceRecord {
  const enInvoice = invoice.en_invoice;
  if (!enInvoice) {
    throw new Error("Incoming Super PDP invoice has no EN16931 metadata");
  }
  const totals = enInvoice.invoice_totals ?? enInvoice.totals;
  if (!totals) {
    throw new Error("Incoming Super PDP invoice has no totals");
  }
  const sellerIdentifier =
    enInvoice.seller.legal_registration_identifier?.value ??
    enInvoice.seller.identifiers?.[0]?.value;
  if (!sellerIdentifier) {
    throw new Error("Incoming Super PDP invoice has no seller identifier");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(enInvoice.issue_date)) {
    throw new Error("Incoming Super PDP invoice has an invalid issue date");
  }

  return {
    superPdpInvoiceId: invoice.id,
    sellerName: enInvoice.seller.name,
    sellerIdentifier,
    number: enInvoice.number,
    issueDate: enInvoice.issue_date,
    totalExclTax: getRequiredTotal(
      totals,
      ["sum_invoice_line_net_amount", "invoice_total_amount_without_vat"],
      "total excluding tax",
    ),
    totalTax: getRequiredTotal(totals, ["invoice_total_vat_amount"], "VAT total"),
    totalInclTax: getRequiredTotal(
      totals,
      ["invoice_total_amount_with_vat", "payable_amount"],
      "total including tax",
    ),
    currency: enInvoice.currency_code,
  };
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
      await tx
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
    }

    if (lastEventId) {
      await tx
        .update(storeSuperPdpIntegrations)
        .set({ lastEventCursor: lastEventId, updatedAt: new Date() })
        .where(eq(storeSuperPdpIntegrations.integrationId, input.integrationId));
    }
  });

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
      details: [
        {
          net_amount: reportedAmount,
          currency_code: invoice.currency,
          type_code: "MEN",
          ...(singleVatRate ? { vat_rate: singleVatRate } : {}),
        },
      ],
    }),
  );
  await db
    .update(invoices)
    .set({ latestSuperPdpStatus: "fr:212", updatedAt: new Date() })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.storeId, invoice.storeId)));
}

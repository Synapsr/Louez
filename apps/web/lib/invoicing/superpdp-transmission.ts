import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

import { db, documents, invoices, storeIntegrations } from "@louez/db";

import { log } from "@/lib/evlog";
import {
  getSuperPdpIntegrationForStore,
  isSuperPdpReconnectError,
  markSuperPdpIntegrationFailure,
  markSuperPdpIntegrationHealthy,
} from "@/lib/integrations/providers/superpdp/connection";
import { withSuperPdpAccessToken } from "@/lib/integrations/providers/superpdp/credentials";

import { postInvoicePaymentStatus } from "./superpdp-events";
import {
  SUPERPDP_PROVIDER_KEY,
  SuperPdpApiError,
  convertSuperPdpInvoiceToFacturX,
  sendSuperPdpInvoice,
  validateSuperPdpInvoice,
} from "@/lib/integrations/providers/superpdp/superpdp-client";

const MAX_TRANSMISSION_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 5 * 60 * 1000;

function getRetryDate(attemptCount: number): Date {
  const delayMinutes = Math.min(24 * 60, 2 ** Math.max(0, attemptCount));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

function decodePdfDataUrl(fileUrl: string): Uint8Array {
  const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(fileUrl);
  if (!match?.[1]) throw new Error("Invoice document is not a PDF data URL");

  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Invoice document does not contain a valid PDF header");
  }

  return new Uint8Array(bytes);
}

async function loadInvoiceForTransmission(invoiceId: string) {
  const [row] = await db
    .select({
      id: invoices.id,
      storeId: invoices.storeId,
      number: invoices.number,
      en16931Snapshot: invoices.en16931Snapshot,
      superPdpInvoiceId: invoices.superPdpInvoiceId,
      fileUrl: documents.fileUrl,
      fileName: documents.fileName,
    })
    .from(invoices)
    .innerJoin(documents, eq(documents.id, invoices.documentId))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!row) throw new Error("Invoice or invoice document was not found");
  return row;
}

export async function sendInvoiceToSuperPdp(
  invoiceId: string,
): Promise<{ superPdpInvoiceId: string }> {
  const invoice = await loadInvoiceForTransmission(invoiceId);
  if (invoice.superPdpInvoiceId) {
    return { superPdpInvoiceId: invoice.superPdpInvoiceId };
  }

  const integration = await getSuperPdpIntegrationForStore(invoice.storeId);
  if (!integration) {
    throw new Error("Store has no connected Super PDP integration");
  }

  const pdf = decodePdfDataUrl(invoice.fileUrl);
  const facturX = await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
    convertSuperPdpInvoiceToFacturX({
      accessToken,
      pdf,
      fileName: invoice.fileName,
      en16931: invoice.en16931Snapshot,
    }),
  );
  const validation = await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
    validateSuperPdpInvoice({
      accessToken,
      invoice: facturX,
      fileName: invoice.fileName,
    }),
  );
  if (validation.data.length === 0 || validation.data.some((report) => !report.is_valid)) {
    throw new Error("Super PDP rejected the Factur-X validation report");
  }

  const sent = await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
    sendSuperPdpInvoice({
      accessToken,
      invoice: facturX,
      externalId: invoice.id,
    }),
  );

  await db
    .update(invoices)
    .set({
      transmissionStatus: "sent",
      superPdpInvoiceId: sent.id,
      nextAttemptAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.storeId, invoice.storeId)));
  await markSuperPdpIntegrationHealthy(integration.integrationId);

  // Invoices are generated at cash-in, so a freshly transmitted invoice is
  // already paid: this is the earliest moment fr:212 can reach Super PDP
  // (the provider id did not exist before this call).
  void postInvoicePaymentStatus(invoice.id).catch((error) => {
    log.error(
      "superpdp",
      `payment e-reporting failed for ${invoice.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return { superPdpInvoiceId: sent.id };
}

async function claimInvoiceForTransmission(
  invoiceId: string,
): Promise<{ attemptCount: number; storeId: string } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        storeId: invoices.storeId,
        transmissionStatus: invoices.transmissionStatus,
        attemptCount: invoices.attemptCount,
        nextAttemptAt: invoices.nextAttemptAt,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)
      .for("update");
    const now = new Date();

    if (
      !row ||
      (row.transmissionStatus !== "pending" && row.transmissionStatus !== "failed") ||
      row.attemptCount >= MAX_TRANSMISSION_ATTEMPTS ||
      (row.nextAttemptAt && row.nextAttemptAt > now)
    ) {
      return null;
    }

    const attemptCount = row.attemptCount + 1;
    await tx
      .update(invoices)
      .set({
        attemptCount,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        updatedAt: now,
      })
      .where(eq(invoices.id, invoiceId));

    return { attemptCount, storeId: row.storeId };
  });
}

export async function processInvoiceTransmissionQueue(
  limit = 25,
): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date();
  const candidates = await db
    .select({ id: invoices.id })
    .from(invoices)
    .innerJoin(
      storeIntegrations,
      and(
        eq(storeIntegrations.storeId, invoices.storeId),
        eq(storeIntegrations.providerKey, SUPERPDP_PROVIDER_KEY),
      ),
    )
    .where(
      and(
        inArray(invoices.transmissionStatus, ["pending", "failed"]),
        or(isNull(invoices.nextAttemptAt), lte(invoices.nextAttemptAt, now)),
        lt(invoices.attemptCount, MAX_TRANSMISSION_ATTEMPTS),
        eq(storeIntegrations.enabled, true),
        inArray(storeIntegrations.status, ["active", "error"]),
      ),
    )
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let processed = 0;

  for (const candidate of candidates) {
    const claim = await claimInvoiceForTransmission(candidate.id);
    if (!claim) continue;
    processed++;

    try {
      await sendInvoiceToSuperPdp(candidate.id);
      sent++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";
      await db
        .update(invoices)
        .set({
          transmissionStatus: "failed",
          nextAttemptAt:
            claim.attemptCount >= MAX_TRANSMISSION_ATTEMPTS
              ? null
              : getRetryDate(claim.attemptCount),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, candidate.id), eq(invoices.storeId, claim.storeId)));

      const integration = await getSuperPdpIntegrationForStore(claim.storeId);
      const providerFailure =
        error instanceof SuperPdpApiError ||
        error instanceof TypeError ||
        isSuperPdpReconnectError(error);
      if (integration && providerFailure) {
        await markSuperPdpIntegrationFailure(integration.integrationId, error);
      }
      log.error("superpdp", `Invoice transmission failed for ${candidate.id}: ${message}`);
    }
  }

  return { processed, sent, failed };
}

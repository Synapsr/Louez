import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, documents, receivedInvoices } from "@louez/db";

import { getSuperPdpIntegrationForStore } from "@/lib/integrations/providers/superpdp/connection";
import { withSuperPdpAccessToken } from "@/lib/integrations/providers/superpdp/credentials";
import {
  createSuperPdpInvoiceEvent,
  downloadSuperPdpInvoice,
} from "@/lib/integrations/providers/superpdp/superpdp-client";

type ReceivedInvoiceActionInput = {
  storeId: string;
  receivedInvoiceId: string;
};

async function postReceivedInvoiceAction(input: {
  storeId: string;
  receivedInvoiceId: string;
  statusCode: "fr:204" | "fr:205" | "fr:210";
  action: "acknowledged" | "accepted" | "refused";
  reason?: string;
}): Promise<void> {
  const [invoice, integration] = await Promise.all([
    db
      .select({
        id: receivedInvoices.id,
        superPdpInvoiceId: receivedInvoices.superPdpInvoiceId,
      })
      .from(receivedInvoices)
      .where(
        and(
          eq(receivedInvoices.id, input.receivedInvoiceId),
          eq(receivedInvoices.storeId, input.storeId),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null),
    getSuperPdpIntegrationForStore(input.storeId),
  ]);
  if (!invoice) throw new Error("Received invoice was not found");
  if (!integration) throw new Error("Store has no connected Super PDP integration");

  await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
    createSuperPdpInvoiceEvent({
      accessToken,
      invoiceId: invoice.superPdpInvoiceId,
      statusCode: input.statusCode,
      reason: input.reason,
    }),
  );
  await db
    .update(receivedInvoices)
    .set({
      ourAction: input.action,
      latestStatus: input.statusCode,
      updatedAt: new Date(),
    })
    .where(and(eq(receivedInvoices.id, invoice.id), eq(receivedInvoices.storeId, input.storeId)));
}

export function acknowledgeReceivedInvoice(input: ReceivedInvoiceActionInput): Promise<void> {
  return postReceivedInvoiceAction({
    ...input,
    statusCode: "fr:204",
    action: "acknowledged",
  });
}

export function acceptReceivedInvoice(input: ReceivedInvoiceActionInput): Promise<void> {
  return postReceivedInvoiceAction({
    ...input,
    statusCode: "fr:205",
    action: "accepted",
  });
}

export function refuseReceivedInvoice(
  input: ReceivedInvoiceActionInput & { reason?: string },
): Promise<void> {
  return postReceivedInvoiceAction({
    ...input,
    statusCode: "fr:210",
    action: "refused",
  });
}

function isPdf(content: Uint8Array): boolean {
  return content.length >= 5 && Buffer.from(content.subarray(0, 5)).toString("ascii") === "%PDF-";
}

function getReceivedInvoiceFileName(number: string): string {
  const safeNumber = number.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `invoice-${safeNumber || "received"}.pdf`;
}

export async function downloadReceivedInvoicePdf(
  input: ReceivedInvoiceActionInput,
): Promise<{ documentId: string }> {
  const [invoice, integration] = await Promise.all([
    db
      .select({
        id: receivedInvoices.id,
        number: receivedInvoices.number,
        superPdpInvoiceId: receivedInvoices.superPdpInvoiceId,
        documentId: receivedInvoices.documentId,
      })
      .from(receivedInvoices)
      .where(
        and(
          eq(receivedInvoices.id, input.receivedInvoiceId),
          eq(receivedInvoices.storeId, input.storeId),
        ),
      )
      .limit(1)
      .then(([row]) => row ?? null),
    getSuperPdpIntegrationForStore(input.storeId),
  ]);
  if (!invoice) throw new Error("Received invoice was not found");
  if (invoice.documentId) return { documentId: invoice.documentId };
  if (!integration) throw new Error("Store has no connected Super PDP integration");

  const downloaded = await withSuperPdpAccessToken(integration.integrationId, (accessToken) =>
    downloadSuperPdpInvoice({
      accessToken,
      invoiceId: invoice.superPdpInvoiceId,
    }),
  );
  if (!isPdf(downloaded.content)) {
    throw new Error("Downloaded Super PDP invoice has an invalid PDF header");
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ documentId: receivedInvoices.documentId })
      .from(receivedInvoices)
      .where(and(eq(receivedInvoices.id, invoice.id), eq(receivedInvoices.storeId, input.storeId)))
      .limit(1)
      .for("update");
    if (!current) throw new Error("Received invoice was not found");
    if (current.documentId) return { documentId: current.documentId };

    const documentId = nanoid();
    const fileName = getReceivedInvoiceFileName(invoice.number);
    await tx.insert(documents).values({
      id: documentId,
      reservationId: null,
      type: "invoice",
      number: invoice.number,
      fileUrl: `data:application/pdf;base64,${Buffer.from(downloaded.content).toString("base64")}`,
      fileName,
      generatedAt: new Date(),
    });
    await tx
      .update(receivedInvoices)
      .set({ documentId, updatedAt: new Date() })
      .where(and(eq(receivedInvoices.id, invoice.id), eq(receivedInvoices.storeId, input.storeId)));

    return { documentId };
  });
}

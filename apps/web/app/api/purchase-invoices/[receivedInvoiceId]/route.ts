import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, documents } from "@louez/db";

import { log } from "@/lib/evlog";
import { downloadReceivedInvoicePdf } from "@/lib/invoicing/superpdp-received";
import { getCurrentStore } from "@/lib/store-context";

const routeParamsSchema = z.object({
  receivedInvoiceId: z.string().length(21),
});

const PDF_DATA_URL_PREFIX = "data:application/pdf;base64,";

function safePdfFileName(fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.endsWith(".pdf") ? sanitized : `${sanitized || "invoice"}.pdf`;
}

/**
 * Serve the PDF of a received supplier invoice.
 *
 * The document is fetched from Super PDP on first download and cached in
 * `documents`; the helper is store-scoped, so an invoice belonging to another
 * store is indistinguishable from one that does not exist.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ receivedInvoiceId: string }> },
) {
  const parsed = routeParamsSchema.safeParse(await params);
  if (!parsed.success) return new Response("Invalid invoice route", { status: 400 });

  const store = await getCurrentStore();
  if (!store) return new Response("Unauthorized", { status: 401 });

  let documentId: string;
  try {
    ({ documentId } = await downloadReceivedInvoicePdf({
      receivedInvoiceId: parsed.data.receivedInvoiceId,
      storeId: store.id,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    log.error("superpdp", `Received invoice download failed for store ${store.id}: ${message}`);

    return new Response("Invoice PDF not available", { status: 502 });
  }

  const [document] = await db
    .select({ fileName: documents.fileName, fileUrl: documents.fileUrl })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!document) return new Response("Invoice not found", { status: 404 });
  if (!document.fileUrl.startsWith(PDF_DATA_URL_PREFIX)) {
    return new Response("Invoice PDF not available", { status: 404 });
  }

  const pdf = Buffer.from(document.fileUrl.slice(PDF_DATA_URL_PREFIX.length), "base64");
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return new Response("Invalid invoice PDF", { status: 500 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${safePdfFileName(document.fileName)}"`,
      "Content-Type": "application/pdf",
    },
  });
}

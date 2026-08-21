import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, documents, invoices } from "@louez/db";

import { getCurrentStore } from "@/lib/store-context";

const invoiceRouteParamsSchema = z.object({
  id: z.string().length(21),
  invoiceId: z.string().length(21),
});

const PDF_DATA_URL_PREFIX = "data:application/pdf;base64,";

function safePdfFileName(fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.endsWith(".pdf") ? sanitized : `${sanitized || "invoice"}.pdf`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> },
) {
  const parsed = invoiceRouteParamsSchema.safeParse(await params);
  if (!parsed.success) return new Response("Invalid invoice route", { status: 400 });

  const store = await getCurrentStore();
  if (!store) return new Response("Unauthorized", { status: 401 });

  const [invoice] = await db
    .select({
      fileName: documents.fileName,
      fileUrl: documents.fileUrl,
    })
    .from(invoices)
    .innerJoin(documents, eq(documents.id, invoices.documentId))
    .where(
      and(
        eq(invoices.id, parsed.data.invoiceId),
        eq(invoices.reservationId, parsed.data.id),
        eq(invoices.storeId, store.id),
      ),
    )
    .limit(1);
  if (!invoice) return new Response("Invoice not found", { status: 404 });
  if (!invoice.fileUrl.startsWith(PDF_DATA_URL_PREFIX)) {
    return new Response("Invoice PDF not available", { status: 404 });
  }

  const pdf = Buffer.from(invoice.fileUrl.slice(PDF_DATA_URL_PREFIX.length), "base64");
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return new Response("Invalid invoice PDF", { status: 500 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safePdfFileName(invoice.fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

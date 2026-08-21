import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, documents, invoices } from "@louez/db";

import { buildPdfResponse } from "@/lib/invoicing/util.pdf-response";
import { getCurrentStore } from "@/lib/store-context";

const invoiceRouteParamsSchema = z.object({
  id: z.string().length(21),
  invoiceId: z.string().length(21),
});

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
  return buildPdfResponse(invoice.fileUrl, invoice.fileName);
}
